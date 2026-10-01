// Architecture decision records written from the page: which project they
// go beside, the fields a record must have, and the file as MADR.

import { createHash, randomUUID } from "node:crypto";
import { globSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve, sep } from "node:path";

import { readManifestText } from "../manifest.mjs";
import { slug } from "../local-discovery.mjs";
import { safeWorkspacePath } from "./workspace.mjs";
import { writeManifest } from "./manifest-file.mjs";

const ADR_BODY_LIMIT = 256 * 1024;
const ADR_STATUSES = new Set(["proposed", "accepted", "superseded", "deprecated", "rejected"]);
const ADR_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\.\d{4}$/;
const ADR_SERVICE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const ADR_EVENT = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/;
const ADR_FLOW = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function adrScope(project, step) {
  const configured = String(step?.options?.scope ?? "").trim();
  if (configured) return configured;
  const group = project.group ?? project.context;
  const component = project.component ?? project.service;
  return [group, component].filter(Boolean).join(".") || group || "org";
}

function adrPrefix(scope) {
  if (scope === "org") return "org";
  return scope.split(".").filter(Boolean).at(-1) || "org";
}

function adrStepFor(manifest, project) {
  const output = posix.join(project.root, "portolan");
  return (manifest.extract ?? []).find((step) => step?.plugin === "adr" && step?.out === output) ?? null;
}

function adrPatterns(step) {
  const configured = Array.isArray(step?.options?.files)
    ? step.options.files.filter((value) => typeof value === "string" && value.trim())
    : [];
  return configured.length ? configured : ["docs/adr/*.md"];
}

/** Files an ADR step already reads, relative to its input root. */
function adrStepFiles(workspace, step) {
  const input = safeWorkspacePath(workspace, step.in, "ADR input");
  const files = new Set();
  for (const pattern of adrPatterns(step)) {
    const clean = pattern.replaceAll("\\", "/");
    if (clean.startsWith("/") || clean.split("/").includes("..")) throw new Error("ADR file patterns must stay inside the project.");
    for (const name of globSync(clean, { cwd: input.absolute })) {
      const normalized = String(name).replaceAll("\\", "/");
      if (posix.basename(normalized).toLowerCase() !== "readme.md") files.add(normalized);
    }
  }
  return { input, files: [...files].sort() };
}

function adrDirectory(workspace, project, step) {
  const { input, files } = adrStepFiles(workspace, step);
  const populated = new Map();
  for (const file of files) populated.set(posix.dirname(file), (populated.get(posix.dirname(file)) ?? 0) + 1);
  const existing = [...populated].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const literal = adrPatterns(step)
    .map((pattern) => posix.dirname(pattern.replaceAll("\\", "/")))
    .find((dir) => !/[?*[\]{}]/.test(dir));
  const directory = existing ?? literal;
  if (!directory) throw new Error(`Project "${project.id}" uses an ADR glob whose destination is ambiguous. Give its adr step a literal directory such as docs/adr/*.md.`);
  const relativeDirectory = posix.normalize(posix.join(input.relative, directory === "." ? "" : directory));
  const safe = safeWorkspacePath(workspace, relativeDirectory, "ADR directory");
  const projectRoot = safeWorkspacePath(workspace, project.root, "Project root");
  if (safe.absolute !== projectRoot.absolute && !safe.absolute.startsWith(`${projectRoot.absolute}${sep}`)) {
    throw new Error(`Project "${project.id}" writes ADRs outside its project root.`);
  }
  return { directory: safe.relative, absolute: safe.absolute, files, input: input.relative };
}

function adrFileNumber(name) {
  const match = /^(\d+)-[a-z0-9_]+(?:-[a-z0-9_]+)*\.md$/i.exec(posix.basename(name));
  return match ? Number(match[1]) : 0;
}

function adrProjectDescriptor(workspace, manifest, project) {
  const step = adrStepFor(manifest, project) ?? {
    plugin: "adr",
    in: project.root,
    out: posix.join(project.root, "portolan"),
    options: { files: ["docs/adr/*.md"], scope: adrScope(project), out: "adr.json" },
  };
  const target = adrDirectory(workspace, project, step);
  const highest = target.files.reduce((number, file) => Math.max(number, adrFileNumber(file)), 0);
  const scope = adrScope(project, step);
  return {
    id: project.id,
    name: project.name,
    root: project.root,
    scope,
    prefix: adrPrefix(scope),
    directory: target.directory,
    count: target.files.length,
    nextNumber: highest + 1,
    files: target.files.map((file) => {
      const location = safeWorkspacePath(workspace, posix.join(target.input, file), "ADR file");
      const content = readFileSync(location.absolute, "utf8");
      return {
        path: location.relative,
        revision: createHash("sha256").update(content).digest("hex"),
      };
    }),
    configured: adrStepFor(manifest, project) !== null,
    writable: !project.repository,
    ...(project.repository ? { reason: "This project is an imported repository snapshot. Create the ADR in its source checkout." } : {}),
  };
}

/** The projects an ADR can be written beside, including records already read from their code. */
export function adrProjectsState(workspace) {
  const manifestPath = join(workspace, "portolan.json");
  const text = readFileSync(manifestPath, "utf8");
  const manifest = readManifestText(text, manifestPath);
  return {
    revision: createHash("sha256").update(text).digest("hex"),
    projects: (manifest.projects ?? []).map((project) => adrProjectDescriptor(workspace, manifest, project)),
  };
}

function validAdrDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function adrStringList(value, name, pattern) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${name} must be a list of at most 100 ids.`);
  const result = [];
  for (const raw of value) {
    const id = String(raw ?? "").trim();
    if (!pattern.test(id)) throw new Error(`${JSON.stringify(id)} is not a valid ${name} id.`);
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

function adrFields(request, id) {
  const title = String(request.title ?? "").trim();
  if (!title || title.length > 180 || /[\r\n\0]/.test(title)) throw new Error("ADR title must be one line between 1 and 180 characters.");
  const status = String(request.status ?? "");
  if (!ADR_STATUSES.has(status)) throw new Error("Choose a valid ADR status.");
  const date = String(request.date ?? "");
  if (!validAdrDate(date)) throw new Error("ADR date must be a real date written as YYYY-MM-DD.");
  const body = String(request.body ?? "").replaceAll("\r\n", "\n").trim();
  if (!body.startsWith("## ")) throw new Error("ADR body must begin with a level-two Markdown heading.");
  if (Buffer.byteLength(body, "utf8") > ADR_BODY_LIMIT) throw new Error("ADR body is larger than 256 KB.");
  const note = String(request.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > 500 || /[\r\n\0]/.test(note)) throw new Error("ADR note must be one line of at most 500 characters.");
  const supersededBy = String(request.supersededBy ?? "").trim();
  if (supersededBy && !ADR_ID.test(supersededBy)) throw new Error("Superseded by must name an ADR id.");
  if (status === "superseded" && !supersededBy) throw new Error("A superseded ADR must say which ADR superseded it.");
  if (status !== "superseded" && supersededBy) throw new Error("Only a superseded ADR can name its successor.");
  if (supersededBy === id) throw new Error("An ADR cannot supersede itself.");
  const supersedes = adrStringList(request.supersedes, "supersedes", ADR_ID);
  if (supersedes.includes(id)) throw new Error("An ADR cannot supersede itself.");
  const services = adrStringList(request.relates?.services, "service", ADR_SERVICE);
  const events = adrStringList(request.relates?.events, "event", ADR_EVENT);
  const flows = adrStringList(request.relates?.flows, "flow", ADR_FLOW);
  return { title, status, date, body, note, supersededBy, supersedes, relates: [...services, ...events, ...flows] };
}

function adrMarkdown({ id, scope, fields }) {
  const metadata = [
    `- **Status:** ${fields.status}`,
    `- **Date:** ${fields.date}`,
    `- **Scope:** ${scope}`,
    ...(fields.supersededBy ? [`- **Superseded by:** ${fields.supersededBy}`] : []),
    ...(fields.supersedes.length ? [`- **Supersedes:** ${fields.supersedes.join(", ")}`] : []),
    ...(fields.relates.length ? [`- **Relates:** ${fields.relates.join(", ")}`] : []),
    ...(fields.note ? [`- **Note:** ${fields.note}`] : []),
  ];
  return `# ${id} — ${fields.title}\n\n${metadata.join("\n")}\n\n${fields.body}\n`;
}

function writeAdrAtomically(target, markdown) {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, markdown, { flag: "wx" });
    renameSync(temporary, target);
  } catch (cause) {
    rmSync(temporary, { force: true });
    throw cause;
  }
}

/** Write one MADR record into the selected project's existing ADR source tree. */
export function createProjectAdr(workspace, request) {
  const manifestPath = join(workspace, "portolan.json");
  const before = readFileSync(manifestPath, "utf8");
  const manifest = readManifestText(before, manifestPath);
  if (request?.revision !== createHash("sha256").update(before).digest("hex")) {
    throw new Error("portolan.json changed while this ADR was being written. Reload the editor and try again.");
  }
  const project = (manifest.projects ?? []).find((candidate) => candidate.id === request.projectId);
  if (!project) throw new Error(`Project "${String(request?.projectId ?? "")}" does not exist.`);
  const descriptor = adrProjectDescriptor(workspace, manifest, project);
  if (!descriptor.writable) throw new Error(descriptor.reason);
  if (request.number !== descriptor.nextNumber) throw new Error(`The next ADR is now ${String(descriptor.nextNumber).padStart(4, "0")}. Reload the editor and try again.`);

  const number = descriptor.nextNumber;
  const padded = String(number).padStart(4, "0");
  const id = `${descriptor.prefix}.${padded}`;
  const fields = adrFields(request, id);
  const titleSlug = slug(fields.title) || "decision";
  const name = `${padded}-${titleSlug}.md`;
  const target = resolve(realpathSync(workspace), descriptor.directory, name);
  const directory = dirname(target);
  const markdown = adrMarkdown({ id, scope: descriptor.scope, fields });

  mkdirSync(directory, { recursive: true });
  writeFileSync(target, markdown, { flag: "wx" });
  let manifestChanged = false;
  try {
    if (!adrStepFor(manifest, project)) {
      manifest.extract = [...(manifest.extract ?? []), {
        plugin: "adr",
        in: project.root,
        out: posix.join(project.root, "portolan"),
        options: { files: ["docs/adr/*.md"], scope: descriptor.scope, out: "adr.json" },
      }];
      writeManifest(manifestPath, manifest);
      manifestChanged = true;
    }
  } catch (cause) {
    rmSync(target, { force: true });
    throw cause;
  }
  return {
    id,
    slug: `${id.replaceAll(".", "-")}-${titleSlug}`,
    number,
    title: fields.title,
    path: posix.join(descriptor.directory, name),
    manifestChanged,
  };
}

/** Rewrites one existing MADR file only when both manifest and file revisions still match. */
export function updateProjectAdr(workspace, request) {
  const manifestPath = join(workspace, "portolan.json");
  const before = readFileSync(manifestPath, "utf8");
  const manifest = readManifestText(before, manifestPath);
  if (request?.revision !== createHash("sha256").update(before).digest("hex")) {
    throw new Error("portolan.json changed while this ADR was being edited. Reload the editor and try again.");
  }
  const project = (manifest.projects ?? []).find((candidate) => candidate.id === request.projectId);
  if (!project) throw new Error(`Project "${String(request?.projectId ?? "")}" does not exist.`);
  const descriptor = adrProjectDescriptor(workspace, manifest, project);
  if (!descriptor.writable) throw new Error(descriptor.reason);
  const source = String(request.path ?? "").replaceAll("\\", "/");
  const file = descriptor.files.find((candidate) => candidate.path === source);
  if (!file) throw new Error("The ADR file is not part of this project's configured ADR source tree.");
  if (request.fileRevision !== file.revision) throw new Error("The ADR changed on disk while it was being edited. Reload the editor and try again.");
  const number = adrFileNumber(source);
  if (!number || number !== request.number) throw new Error("The ADR number no longer matches its source file.");
  const padded = String(number).padStart(4, "0");
  const id = `${descriptor.prefix}.${padded}`;
  const fields = adrFields(request, id);
  const location = safeWorkspacePath(workspace, source, "ADR file");
  writeAdrAtomically(location.absolute, adrMarkdown({ id, scope: descriptor.scope, fields }));
  const fileSlug = posix.basename(source, ".md").replace(/^\d+-/, "");
  return {
    id,
    slug: `${id.replaceAll(".", "-")}-${fileSlug}`,
    number,
    title: fields.title,
    path: source,
    manifestChanged: false,
  };
}
