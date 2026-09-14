import { accessSync, constants, existsSync, globSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, linkSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { readManifest } from "./manifest.mjs";
import { stampsFor } from "./history.mjs";
import { annotationTargetExists, validateAnnotationDocument, validateCatalogAnnotations } from "../src/lib/annotations.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
export const ANNOTATIONS_MODULE = "virtual:portolan-annotations";
const resolvedModule = `\0${ANNOTATIONS_MODULE}`;
const profiles = (manifest) => manifest.catalogs?.length ? manifest.catalogs : [{ id: "default", sources: manifest.sources ?? [], contexts: [], annotations: manifest.annotations }];
const documentPath = (directory, target) => `${directory}/${target.kind}/${encodeURIComponent(target.id)}.json`;

// Dedicated workspace storage. Reject symlinks even when they lead back inside
// the workspace, so authored data cannot accidentally rewrite project sources.
function safePath(workspace, path) {
  const root = realpathSync(workspace);
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid annotation path.");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error("Annotation storage must not contain symlinks."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return current;
}
function directoryFor(profile) {
  const directory = `annotations/${profile.id}`;
  if (profile.annotations !== undefined && profile.annotations !== directory) throw new Error(`Catalog ${profile.id}: annotations must be stored in ${directory}.`);
  return directory;
}
function configuredEntries(workspace, manifest) {
  const entries = [];
  for (const profile of profiles(manifest)) {
    if (!profile.annotations) continue;
    const directory = directoryFor(profile);
    safePath(workspace, directory);
    for (const path of globSync(`${directory}/**/*.json`, { cwd: workspace }).sort()) {
      const source = path.split(sep).join("/");
      const content = readFileSync(safePath(workspace, source), "utf8");
      if (content.length > 256000) throw new Error(`${source}: annotations exceed 256 KB.`);
      let doc;
      try { doc = validateAnnotationDocument(JSON.parse(content)); } catch (cause) { throw new Error(`${source}: ${cause.message}`); }
      if (doc.catalog !== profile.id || source !== documentPath(directory, doc.target)) throw new Error(`${source}: annotation identity does not match its file path.`);
      entries.push({ ...doc, source, basis: "declared" });
    }
  }
  validateCatalogAnnotations(entries);
  return entries;
}
export function readAnnotations(workspace, manifest = readManifest(join(workspace, "portolan.json"))) {
  return configuredEntries(workspace, manifest);
}
function sourceTargets(workspace, profile) {
  const contexts = [];
  for (const path of globSync(profile.sources ?? [], { cwd: workspace })) {
    const fragment = JSON.parse(readFileSync(resolve(workspace, path), "utf8"));
    contexts.push(...(fragment.contexts ?? []));
  }
  return { contexts: profile.contexts?.length ? contexts.filter((c) => profile.contexts.includes(c.id)) : contexts };
}
export function annotationState(workspace, catalog, target) {
  validateAnnotationDocument({ version: 1, catalog, target, properties: {}, order: [] });
  const manifestPath = join(workspace, "portolan.json");
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = readManifest(manifestPath);
  const profile = profiles(manifest).find((p) => p.id === catalog);
  if (!profile) throw new Error(`Unknown catalog ${catalog}.`);
  const path = documentPath(directoryFor(profile), target);
  const absolute = safePath(workspace, path);
  const content = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
  const document = content === null ? { version: 1, catalog, target, properties: {}, order: [] } : validateAnnotationDocument(JSON.parse(content));
  if (document.catalog !== catalog || document.target.kind !== target.kind || document.target.id !== target.id) throw new Error(`${path}: annotation target does not match the requested resource.`);
  let writable = annotationTargetExists(sourceTargets(workspace, profile), target);
  let reason = writable ? undefined : "This resource is missing from the catalog sources. Its properties are preserved on disk.";
  try {
    accessSync(manifestPath, constants.W_OK);
    let parent = dirname(absolute);
    while (!existsSync(parent)) parent = dirname(parent);
    accessSync(parent, constants.W_OK);
  } catch { writable = false; reason = "The catalog workspace is not writable."; }
  return { catalog, target, path, revision: hash(manifestText), fileRevision: content === null ? null : hash(content), document, writable, reason, workspace: realpathSync(workspace) };
}
function atomicWrite(path, content, absent = false) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { flag: "wx" });
    if (absent) linkSync(temp, path); else renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}
export function saveAnnotation(workspace, request) {
  const doc = validateAnnotationDocument(request.document);
  const content = `${JSON.stringify(doc, null, 2)}\n`;
  if (content.length > 256000) throw new Error("Annotations exceed 256 KB.");
  const current = annotationState(workspace, doc.catalog, doc.target);
  if (request.revision !== current.revision || request.fileRevision !== current.fileRevision) throw Object.assign(new Error("Properties or catalog configuration changed on disk. Compare with the disk version before saving."), { status: 409 });
  if (!current.writable) throw new Error(current.reason);
  const manifestPath = join(workspace, "portolan.json");
  const before = readFileSync(manifestPath, "utf8");
  const manifest = readManifest(manifestPath);
  const profile = profiles(manifest).find((p) => p.id === doc.catalog);
  // Never permit a generation step to own the annotation directory.
  const directory = directoryFor(profile);
  for (const step of [...(manifest.extract ?? []), ...(manifest.verify ?? []), ...(manifest.generate ?? [])]) {
    if (step.out && (directory === step.out || directory.startsWith(`${step.out}/`) || step.out.startsWith(`${directory}/`))) throw new Error("Annotation storage overlaps a generated output directory.");
  }
  const absolute = safePath(workspace, current.path);
  const previous = current.fileRevision === null ? null : readFileSync(absolute, "utf8");
  try { atomicWrite(absolute, content, current.fileRevision === null); }
  catch (error) { if (error.code === "EEXIST") throw Object.assign(new Error("Another editor created these properties. Reload the disk version."), { status: 409 }); throw error; }
  try {
    if (!profile.annotations) {
      if (manifest.catalogs?.length) profile.annotations = directory; else manifest.annotations = directory;
      if (hash(readFileSync(manifestPath, "utf8")) !== hash(before)) throw Object.assign(new Error("Catalog configuration changed while saving."), { status: 409 });
      atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  } catch (error) {
    if (previous === null) rmSync(absolute); else atomicWrite(absolute, previous);
    throw error;
  }
  return annotationState(workspace, doc.catalog, doc.target);
}
export function annotationsPlugin(workspace) {
  return {
    name: "portolan-annotations",
    resolveId(id) { return id === ANNOTATIONS_MODULE ? resolvedModule : undefined; },
    load(id) {
      if (id !== resolvedModule) return;
      try {
        const entries = readAnnotations(workspace);
        const stamps = Object.fromEntries(stampsFor(workspace, entries.map((entry) => entry.source)));
        return `export default ${JSON.stringify({ entries, stamps, error: null })};`;
      }
      catch (error) { return `export default ${JSON.stringify({ entries: [], stamps: {}, error: error.message })};`; }
    },
    configureServer(server) {
      // A reload after generation must re-read authored files. Do not trigger
      // an eager HMR reload mid-save, which would lose the editor's run state.
      server.middlewares.use((req, _res, next) => {
        if (req.headers.accept?.includes("text/html")) {
          const mod = server.moduleGraph.getModuleById(resolvedModule);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        next();
      });
    },
  };
}
