#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { glob } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { InitError, commandWorks, init as runInit, isInteractive, promptAnswers, toolchainFor } from "./init.mjs";

const installRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(installRoot, "package.json"), "utf8"));

export const VERSION = packageJson.version;

export async function main(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (parsed.version || parsed.command === "version") {
    console.log(VERSION);
    return;
  }
  if (parsed.help || !parsed.command) return help();

  const workspace = resolve(parsed.cwd ?? process.cwd());
  assertWorkspace(workspace);
  process.chdir(workspace);
  process.env.PORTOLAN_SCHEMA = resolve(installRoot, "schema/portolan.schema.json");
  process.env.PORTOLAN_INSTALL_ROOT = installRoot;
  process.env.PORTOLAN_CLI = fileURLToPath(import.meta.url);

  switch (parsed.command) {
    case "init":
      return init(workspace, parsed);
    case "generate":
    case "gen":
      return runScript("scripts/gen.mjs", [], workspace);
    case "check":
      return runScript("scripts/gen.mjs", ["--check"], workspace);
    case "build":
      return build(workspace, parsed);
    case "dev":
      return dev(workspace, parsed);
    case "diff":
      if (!parsed.positionals[0]) fail("diff requires a base branch, tag, or commit");
      return runScript("scripts/diff.mjs", parsed.positionals, workspace);
    case "doctor":
      return doctor(workspace);
    default:
      fail(`unknown command ${JSON.stringify(parsed.command)}; run portolan --help`);
  }
}

function parse(argv) {
  const value = { command: "", positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") value.help = true;
    else if (arg === "--version" || arg === "-v") value.version = true;
    else if (["--cwd", "--output", "--base", "--host", "--port"].includes(arg)) {
      const next = argv[++index];
      if (!next) fail(`${arg} requires a value`);
      value[arg.slice(2)] = next;
    } else if (arg === "--yes" || arg === "-y") value.yes = true;
    else if (arg.startsWith("-")) fail(`unknown option ${arg}`);
    else if (!value.command) value.command = arg;
    else value.positionals.push(arg);
  }
  return value;
}

function help() {
  console.log(`Portolan ${VERSION}

Usage: portolan <command> [options]

Commands:
  init       inspect this repository and create portolan.json
  dev        open the local architecture site
  generate   update catalog fragments, docs, and exports
  check      fail when committed generated files are out of date
  build      build the static site
  diff BASE  describe architecture changes against BASE
  doctor     check the local runtime and project configuration
  version    print the CLI version

Options:
  --cwd DIR       project directory (default: current directory)
  --output DIR    build output (default: dist)
  --base PATH     deployed URL base (default: /)
  --host HOST     dev server host (default: 127.0.0.1)
  --port PORT     dev server port
  --yes, -y       init without questions: take every detected default`);
}

async function init(workspace, options) {
  const interactive = !options.yes && isInteractive();
  let result;
  try {
    result = await runInit(workspace, { version: VERSION, ask: interactive ? promptAnswers(VERSION) : undefined });
  } catch (error) {
    if (error instanceof InitError) fail(error.message);
    throw error;
  }
  if (result.generate) runScript("scripts/gen.mjs", [], workspace);
}

function doctor(workspace) {
  const manifestPath = resolve(workspace, "portolan.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  const checks = [
    ["Node.js >= 24", Number(process.versions.node.split(".")[0]) >= 24, process.version],
    ["portolan.json", Boolean(manifest), "required"],
    ["Git", commandWorks("git", ["--version"]), "used for deterministic source stamps"],
  ];

  // A toolchain is required only when a step in this manifest names a plugin
  // that runs in it; the built-in Go plugins run as wasm and ask for nothing.
  const needed = new Map();
  const steps = manifest ? ["extract", "verify", "generate"].flatMap((phase) => manifest[phase] ?? []) : [];
  for (const name of new Set(steps.map((step) => step.plugin))) {
    const need = toolchainFor(name, (manifest.plugins ?? []).find((plugin) => plugin.name === name));
    if (need) needed.set(need.label, [...(needed.get(need.label) ?? []), name]);
  }
  for (const [label, command, args] of [["Go", "go", ["version"]], ["Python 3", "python3", ["--version"]], ["Java", "java", ["-version"]], ["Cargo", "cargo", ["--version"]]]) {
    const plugins = needed.get(label);
    const present = commandWorks(command, args);
    checks.push([label, present || !plugins, plugins ? `needed by ${plugins.join(", ")}${present ? "" : "; not on PATH"}` : `${present ? "present" : "absent"}; nothing in portolan.json needs it`]);
  }

  for (const [label, ok, note] of checks) {
    console.log(`${ok ? "ok" : "--"}  ${label}${note ? ` — ${note}` : ""}`);
  }
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

async function build(workspace, options) {
  const stage = await prepareSite(workspace);
  generateLikeC4(stage);
  const output = safeOutput(workspace, options.output ?? "dist");
  const env = {
    ...process.env,
    PORTOLAN_WORKSPACE: workspace,
    BASE_PATH: options.base ?? process.env.BASE_PATH ?? "/",
  };
  runNode(packageBin("vite", "bin/vite.js"), ["build", stage, "--config", resolve(stage, "vite.config.ts"), "--outDir", output, "--emptyOutDir"], workspace, env);

  const { siteDocs } = await import(resolve(installRoot, "scripts/site-docs.mjs"));
  const manifest = JSON.parse(readFileSync(resolve(workspace, "portolan.json"), "utf8"));
  const written = siteDocs({ manifest, dist: output });
  copyFileSync(resolve(output, "index.html"), resolve(output, "404.html"));
  console.log(`site: ${relative(workspace, output) || "."}${written.length ? `; mounted ${written.join(", ")}` : ""}`);
}

async function dev(workspace, options) {
  const stage = await prepareSite(workspace);
  generateLikeC4(stage);
  const args = [stage, "--config", resolve(stage, "vite.config.ts"), "--host", options.host ?? "127.0.0.1"];
  if (options.port) args.push("--port", options.port, "--strictPort");
  runNode(packageBin("vite", "bin/vite.js"), args, workspace, {
    ...process.env,
    PORTOLAN_WORKSPACE: workspace,
    BASE_PATH: options.base ?? process.env.BASE_PATH ?? "/",
  });
}

async function prepareSite(workspace) {
  const manifestPath = resolve(workspace, "portolan.json");
  if (!existsSync(manifestPath)) fail("portolan.json is missing; run portolan init first");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const stage = resolve(workspace, ".portolan", "site");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  for (const directory of ["src", "public", "scripts"]) {
    cpSync(resolve(installRoot, directory), resolve(stage, directory), { recursive: true });
  }
  for (const file of ["index.html", "vite.config.ts", "tsconfig.json"]) {
    copyFileSync(resolve(installRoot, file), resolve(stage, file));
  }
  writeFileSync(resolve(stage, "package.json"), '{"private":true,"type":"module"}\n');

  const patternSets = [manifest.sources ?? [], ...(manifest.catalogs ?? []).map((profile) => profile.sources ?? [])];
  const allSources = new Set();
  for (const patterns of patternSets) {
    for (const path of await matchedFiles(workspace, patterns)) allSources.add(path);
  }
  if (allSources.size === 0) fail("no catalog source matches portolan.json; run portolan generate first");

  const flattened = new Map();
  let ordinal = 0;
  for (const source of [...allSources].sort()) {
    const name = `portolan/source-${String(++ordinal).padStart(4, "0")}.json`;
    flattened.set(source, name);
    copyIntoStage(workspace, stage, source, name);
    copyReferencedFiles(workspace, stage, JSON.parse(readFileSync(resolve(workspace, source), "utf8")));
  }

  const stagedManifest = {
    ...manifest,
    sources: [...flattened.values()],
    ...(manifest.catalogs ? {
      catalogs: await Promise.all(manifest.catalogs.map(async (profile) => ({
        ...profile,
        sources: (await matchedFiles(workspace, profile.sources ?? [])).map((path) => flattened.get(path)).filter(Boolean),
      }))),
    } : {}),
  };
  writeFileSync(resolve(stage, "portolan.json"), `${JSON.stringify(stagedManifest, null, 2)}\n`);

  const modules = dependencyRoot();
  symlinkSync(modules, resolve(stage, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return stage;
}

function generateLikeC4(stage) {
  runNode(resolve(stage, "scripts/gen-likec4.mjs"), [], stage);
  // Inside a container likec4 switches to a graphviz binary by default and,
  // finding none, reports "no views found". The wasm engine it uses
  // everywhere else is the one wanted, so it is asked for by name.
  runNode(packageBin("likec4", "bin/likec4.mjs"), ["gen", "react", "likec4", "-o", "src/likec4/generated.jsx", "--no-use-dot"], stage);
}

async function matchedFiles(workspace, patterns) {
  const found = new Set();
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || !pattern) continue;
    for await (const path of glob(pattern, { cwd: workspace })) {
      const absolute = resolve(workspace, path);
      if (inside(workspace, absolute) && statSync(absolute).isFile()) found.add(relative(workspace, absolute).split(sep).join("/"));
    }
  }
  return [...found].sort();
}

function copyReferencedFiles(workspace, stage, value) {
  const visit = (item) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (item && typeof item === "object") return Object.values(item).forEach(visit);
    if (typeof item !== "string" || item.includes("://")) return;
    const clean = item.replace(/:\d+(?::\d+)?$/, "").replaceAll("\\", "/");
    if (!clean || isAbsolute(clean) || clean.split("/").includes("..")) return;
    const source = resolve(workspace, clean);
    if (!inside(workspace, source) || !existsSync(source) || !statSync(source).isFile()) return;
    copyIntoStage(workspace, stage, clean, clean);
  };
  visit(value);
}

function copyIntoStage(workspace, stage, source, target) {
  const from = resolve(workspace, source);
  const to = resolve(stage, target);
  if (!inside(workspace, from) || !inside(stage, to)) fail(`unsafe staged path ${source}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function dependencyRoot() {
  let current = installRoot;
  while (dirname(current) !== current) {
    const candidate = resolve(current, "node_modules");
    if (existsSync(resolve(candidate, ".bin")) && existsSync(resolve(candidate, "vite"))) return candidate;
    if (basename(current) === "node_modules") return current;
    current = dirname(current);
  }
  fail("could not locate Portolan's installed dependencies");
}

function packageBin(name, path) {
  const modules = dependencyRoot();
  const direct = resolve(modules, name, path);
  if (existsSync(direct)) return direct;
  fail(`the installed package is missing ${name}`);
}

function runScript(path, args, cwd) {
  const host = prepareHost(cwd);
  return runNode(resolve(host, path), args, cwd, process.env);
}

function prepareHost(workspace) {
  const host = resolve(workspace, ".portolan", "host");
  rmSync(host, { recursive: true, force: true });
  mkdirSync(host, { recursive: true });
  cpSync(resolve(installRoot, "scripts"), resolve(host, "scripts"), { recursive: true });
  cpSync(resolve(installRoot, "src"), resolve(host, "src"), { recursive: true });
  writeFileSync(resolve(host, "package.json"), '{"private":true,"type":"module"}\n');
  symlinkSync(dependencyRoot(), resolve(host, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return host;
}

function runNode(script, args, cwd, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env, stdio: "inherit" });
  if (result.error) fail(result.error.message);
  if (result.signal) process.kill(process.pid, result.signal);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function safeOutput(workspace, value) {
  const output = resolve(workspace, value);
  if (!inside(workspace, output) || output === workspace) fail("build output must be a directory inside the workspace");
  return output;
}

function assertWorkspace(workspace) {
  if (!existsSync(workspace) || !lstatSync(workspace).isDirectory()) fail(`${workspace} is not a directory`);
}

function inside(root, target) {
  const path = relative(resolve(root), resolve(target));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function fail(message) {
  console.error(`portolan: ${message}`);
  process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
