// `portolan init`: look at the repository, propose a manifest, write it.
//
// Detection is the same code the site's Settings page uses to add a project
// (scripts/local-api.mjs), so the CLI and the UI agree on what a repository
// contains. The prompts are the only thing this file adds; with `--yes`, or
// without a terminal, every question takes its default.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, posix, resolve } from "node:path";

import * as p from "@clack/prompts";

import { INSTALL_ROOT, builtinDefinition } from "../scripts/builtin-plugins.mjs";
import { discoverProject, manifestWithProject, planProject, writeManifest } from "../scripts/local-api.mjs";

const TOOLCHAINS = { go: "Go", cargo: "Cargo", java: "Java", python3: "Python 3" };
const VERSION_FLAGS = { go: ["version"], cargo: ["--version"], java: ["-version"], python3: ["--version"] };

export const SCRIPTS = {
  "architecture": "portolan dev",
  "architecture:gen": "portolan generate",
  "architecture:check": "portolan check",
  "architecture:build": "portolan build",
};

export class InitError extends Error {}

/**
 * Create portolan.json for `workspace`.
 *
 * `ask` answers the questions init has; `defaultAnswers` takes every default
 * and `promptAnswers` asks a terminal. Returns what was done so the caller can
 * continue with `portolan generate` when the user asked for it.
 */
export async function init(workspace, { version, ask = defaultAnswers, log = console.log } = {}) {
  const manifestPath = resolve(workspace, "portolan.json");
  if (existsSync(manifestPath)) throw new InitError("portolan.json already exists; init did not change it");

  const projectPackage = readJson(resolve(workspace, "package.json"));
  const repository = slug(String(projectPackage?.name ?? "").replace(/^@[^/]+\//, "")) || slug(basename(workspace)) || "project";

  const scan = ask.scan?.() ?? null;
  const discovery = discoverProject(workspace, ".");
  scan?.done(discovery.filesScanned, discovery.truncated);

  const roots = await ask.roots(rootChoices(discovery.components));
  const single = roots.length === 1 && roots[0] === ".";

  const projects = [];
  const usedIds = new Set();
  for (const root of roots) {
    const found = root === "." ? discovery : discoverProject(workspace, root);
    const id = single ? repository : uniqueId(root, usedIds);
    const defaults = { id, name: titleOf(id), group: single ? id : repository, component: id };
    const identity = single && found.detections.length ? await ask.identity(defaults) : defaults;
    usedIds.add(identity.id);

    const plugins = found.detections.length
      ? await ask.plugins(root, found.detections.map((detection) => ({ ...detection, requirement: toolchainFor(detection.plugin) })))
      : [];
    projects.push({ root, ...identity, plugins });
  }

  const missing = missingToolchains(projects.flatMap((project) => project.plugins));
  for (const [label, plugins] of missing) ask.warn(`${plugins.join(", ")} need${plugins.length === 1 ? "s" : ""} ${label}, which is not on PATH; portolan doctor lists the toolchains`);

  const title = single ? projects[0].name : titleOf(repository);
  const manifest = buildManifest(workspace, projects, { version, title });

  const rows = projects.map((project) => [project.id, project.root, project.plugins.length ? project.plugins.join(", ") : "project (nothing detected)"]);
  const widths = [0, 1].map((column) => Math.max(...rows.map((row) => row[column].length)));
  const summary = rows.map((row) => `${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2]}`);
  if (!(await ask.write(summary))) throw new InitError("cancelled; nothing was written");
  writeManifest(manifestPath, manifest);
  log("created portolan.json");

  const addScripts = projectPackage ? await ask.scripts(Object.keys(SCRIPTS).filter((name) => !(name in (projectPackage.scripts ?? {})))) : false;
  if (addScripts) {
    const merged = { ...(projectPackage.scripts ?? {}) };
    for (const [name, command] of Object.entries(SCRIPTS)) if (!(name in merged)) merged[name] = command;
    writeFileSync(resolve(workspace, "package.json"), `${JSON.stringify({ ...projectPackage, scripts: merged }, null, 2)}\n`);
    log("added architecture scripts to package.json");
  }
  const scriptsReady = Boolean(projectPackage) && Object.keys(SCRIPTS).every((name) => addScripts || name in (projectPackage.scripts ?? {}));

  const ignorePath = resolve(workspace, ".gitignore");
  const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  if (!ignore.split(/\r?\n/).includes(".portolan/")) {
    writeFileSync(ignorePath, `${ignore}${ignore && !ignore.endsWith("\n") ? "\n" : ""}\n# Portolan local build state\n.portolan/\n`);
  }

  const generate = await ask.generate();
  ask.finish(generate, scriptsReady);
  return { manifest, projects, generate };
}

export function nextStep(generate, scriptsReady) {
  const command = scriptsReady
    ? generate ? "npm run architecture" : "npm run architecture:gen && npm run architecture"
    : generate ? "npx @shortlink-org/portolan dev" : "npx @shortlink-org/portolan generate && npx @shortlink-org/portolan dev";
  return `${generate ? "Generating; then" : "Next"}: ${command}`;
}

/** Every question answered with its default: the `--yes` and CI path. */
export const defaultAnswers = {
  roots: (choices) => choices.filter((choice) => choice.selected).map((choice) => choice.path),
  identity: (defaults) => defaults,
  plugins: (root, detections) => detections.filter((detection) => detection.selected && detection.confidence === "high").map((detection) => detection.plugin),
  warn: (message) => console.warn(`portolan: ${message}`),
  write: () => true,
  scripts: (names) => names.length > 0,
  generate: () => false,
  finish: (generate, scriptsReady) => { if (!generate) console.log(nextStep(generate, scriptsReady)); },
};

/** The same questions, asked in a terminal with @clack/prompts. */
export function promptAnswers(version) {
  p.intro(`portolan ${version}`);
  let spinner;
  return {
    scan() {
      spinner = p.spinner();
      spinner.start("Scanning the repository");
      return {
        done(files, truncated) {
          spinner.stop(`Scanned ${files} files${truncated ? " (stopped early; a large repository)" : ""}`);
        },
      };
    },
    async roots(choices) {
      if (choices.length <= 1) return defaultAnswers.roots(choices);
      return answer(await p.multiselect({
        message: "Which directories are projects?",
        options: choices.map((choice) => ({ value: choice.path, label: choice.path, hint: [choice.name, choice.technologies.join(", ")].filter(Boolean).join(" · ") })),
        initialValues: defaultAnswers.roots(choices),
        required: true,
      }));
    },
    async identity(defaults) {
      const id = answer(await p.text({
        message: "Project id",
        initialValue: defaults.id,
        validate: (value) => (slug(value) ? undefined : "Use letters, digits and dashes."),
      }));
      const clean = slug(id);
      return clean === defaults.id ? defaults : { ...defaults, id: clean, name: titleOf(clean), group: clean, component: clean };
    },
    async plugins(root, detections) {
      const chosen = answer(await p.multiselect({
        message: root === "." ? "What should Portolan read?" : `What should Portolan read in ${root}?`,
        options: detections.map((detection) => ({
          value: detection.plugin,
          label: detection.plugin,
          hint: [detection.evidence, detection.requirement?.missing ? `needs ${detection.requirement.label}, not on PATH` : ""].filter(Boolean).join(" · "),
        })),
        initialValues: defaultAnswers.plugins(root, detections),
        required: true,
      }));
      return chosen;
    },
    warn: (message) => p.log.warn(message),
    async write(summary) {
      p.note(summary.join("\n"), "portolan.json");
      return answer(await p.confirm({ message: "Write portolan.json?", initialValue: true }));
    },
    async scripts(names) {
      if (!names.length) return false;
      return answer(await p.confirm({ message: `Add ${names.join(", ")} to package.json scripts?`, initialValue: true }));
    },
    async generate() {
      return answer(await p.confirm({ message: "Run portolan generate now?", initialValue: true }));
    },
    finish(generate, scriptsReady) {
      p.outro(nextStep(generate, scriptsReady));
    },
  };
}

export function isInteractive(env = process.env) {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !env.CI;
}

export function commandWorks(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function answer(value) {
  if (p.isCancel(value)) {
    p.cancel("init cancelled; nothing was written");
    process.exit(0);
  }
  return value;
}

/**
 * Directories that could be projects, with the default choice made: the
 * repository root when it has a build file of its own, otherwise every nested
 * directory that has one.
 */
function rootChoices(components) {
  const rootHasMarkers = components.some((candidate) => candidate.path === ".");
  const nested = components.filter((candidate) => candidate.path !== ".");
  const choices = [
    { path: ".", name: "repository root", markers: [], technologies: [], ...components.find((candidate) => candidate.path === ".") },
    ...nested,
  ];
  return choices.map((choice) => ({ ...choice, selected: choice.path === "." ? rootHasMarkers || nested.length === 0 : !rootHasMarkers }));
}

function buildManifest(workspace, projects, { version, title }) {
  let manifest = {
    $schema: `https://raw.githubusercontent.com/shortlink-org/portolan/${version}/schema/portolan.schema.json`,
    sources: [],
    projects: [],
    extract: [],
  };
  for (const project of projects) {
    if (project.plugins.length) {
      const plan = planProject(workspace, manifest, {
        root: project.root,
        id: project.id,
        name: project.name,
        group: project.group,
        component: project.component,
        plugins: project.plugins,
      });
      manifest = manifestWithProject(manifest, plan);
      continue;
    }
    // Nothing to read yet; the project extractor still gives the site one node.
    const out = posix.join(project.root, "portolan");
    manifest.projects.push({ id: project.id, name: project.name, root: project.root, group: project.group, component: project.component });
    manifest.sources.push(`${out}/*.json`);
    manifest.extract.push({
      plugin: "project",
      in: project.root,
      out,
      options: { group: project.group, groupName: titleOf(project.group), component: project.component, componentName: project.name, out: "project.json" },
    });
  }
  manifest.sources = [...new Set(manifest.sources)];
  manifest.generate = [
    { plugin: "markdown", out: "docs", options: { title } },
    { plugin: "mermaid", out: "exports/mermaid", options: { title: `${title} flows` } },
  ];
  return manifest;
}

const toolchainChecks = new Map();

export function toolchainFor(plugin, declared = null) {
  const command = declared?.process?.command ?? builtinDefinition(plugin)?.process?.command;
  const label = TOOLCHAINS[command];
  if (!label) return null;
  if (!toolchainChecks.has(command)) {
    // The Rust extractor ships as a binary in the Docker image, and
    // run-builtin uses it before it would ever ask for Cargo; doctor and init
    // agree, or the image would report a toolchain it does not need.
    const prebuilt = command === "cargo" && !declared && existsSync(resolve(INSTALL_ROOT, "plugins/extract-rust/target/release/portolan-extract-rust"));
    toolchainChecks.set(command, prebuilt || commandWorks(command, VERSION_FLAGS[command]));
  }
  return { command, label, missing: !toolchainChecks.get(command) };
}

function missingToolchains(plugins) {
  const missing = new Map();
  for (const plugin of new Set(plugins)) {
    const need = toolchainFor(plugin);
    if (!need?.missing) continue;
    missing.set(need.label, [...(missing.get(need.label) ?? []), plugin]);
  }
  return missing;
}

function uniqueId(root, used) {
  const short = slug(posix.basename(root));
  if (short && !used.has(short)) return short;
  return slug(root) || `project-${used.size + 1}`;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function titleOf(value) {
  return value.split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
