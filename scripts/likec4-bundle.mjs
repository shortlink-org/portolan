// Writes the LikeC4 react bundle when it is missing, older than likec4/, or
// written by another generator.
//
// src/likec4/generated/<project>.jsx - one per catalog profile (portolan.0034)
// - is imported by the diagrams and is not committed: it follows from the
// committed likec4/ sources and weighs a megabyte. A
// fresh checkout or worktree has none, and `npx vite` there fails on the
// first page that draws a view. The Vite config asks here before it serves
// or builds, so nobody has to remember `likec4 gen react` first.
//
// Only the react step runs: likec4/ itself is written by `npm run gen` (and
// `npm run likec4:gen`) and held to the catalog by `gen:check`. Deciding
// costs a few stats and two small JSON reads: a bundle at least as new as
// every file under likec4/ is left alone, as long as its stamp names the
// generator that would write it now. Mtimes alone miss an upgrade: npm
// installs likec4 with fixed file dates, so a new version over unchanged .c4
// files still looks older than the bundle. The stamp, git-ignored beside the
// bundle, holds the likec4 version and the command line; a bundle without
// one is regenerated once. `portolan dev` and `portolan build` generate into
// their stage right before Vite starts and stamp it there, so there the
// answer is always "fresh".

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { newestMtime } from "./plugins-fresh.mjs";

const SOURCES = "likec4";
/** One bundle per LikeC4 project, named after it (portolan.0034). */
export const OUT_DIR = "src/likec4/generated";
export const STAMP = "src/likec4/generated.stamp.json";
/** The single bundle an earlier layout wrote beside the diagrams; removed on sight. */
const LEGACY = ["src/likec4/generated.jsx", "src/likec4/generated.d.ts"];
/** What the bundle of a workspace without named projects is called. */
export const UNNAMED = "default";

/**
 * The LikeC4 projects under likec4/: one per folder holding a
 * likec4.config.json, by the name it gives, or else the one unnamed project.
 */
export function likec4Projects(root) {
  let entries = [];
  try {
    entries = readdirSync(join(root, SOURCES), { withFileTypes: true });
  } catch {
    return [UNNAMED];
  }
  const named = entries
    .filter((entry) => entry.isDirectory() && existsSync(join(root, SOURCES, entry.name, "likec4.config.json")))
    .map((entry) => JSON.parse(readFileSync(join(root, SOURCES, entry.name, "likec4.config.json"), "utf8")).name ?? entry.name)
    .sort();
  return named.length > 0 ? named : [UNNAMED];
}

/** The bundle a project is written to, and its types beside it. */
export const bundlePath = (project) => `${OUT_DIR}/${project}.jsx`;
const outputsOf = (project) => [bundlePath(project), bundlePath(project).replace(/\.jsx$/, ".d.ts")];

/**
 * The arguments to likec4's bin that write one project's bundle. --no-use-dot:
 * the wasm layout engine, not a graphviz binary that may be absent (inside a
 * container likec4 switches to one by default and, finding none, reports "no
 * views"). The unnamed project is the workspace itself and needs no --project.
 */
export function likec4ReactArgs(project) {
  return ["gen", "react", SOURCES, ...(project === UNNAMED ? [] : ["--project", project]), "-o", bundlePath(project), "--no-use-dot"];
}

/**
 * The installed likec4 package, resolved like any import from here rather than
 * at ./node_modules/.bin, which a git worktree sharing its parent checkout's
 * node_modules does not have.
 */
function likec4Package() {
  const manifest = createRequire(import.meta.url).resolve("likec4/package.json");
  return { dir: dirname(manifest), version: JSON.parse(readFileSync(manifest, "utf8")).version };
}

/** What the stamp says of bundles written by likec4 `version` with today's arguments. */
export function likec4Stamp(version = likec4Package().version) {
  return { likec4: version, args: likec4ReactArgs("<project>") };
}

/** Records that the bundles in `root` were just written by `stamp`'s generator. */
export function writeLikeC4Stamp(root, stamp = likec4Stamp()) {
  writeFileSync(join(root, STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
}

function stampMatches(root, expected) {
  try {
    return JSON.stringify(JSON.parse(readFileSync(join(root, STAMP), "utf8"))) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

/**
 * Whether every project's bundle exists, is no older than likec4/, and the
 * stamp beside them equals `expected` (by default, the installed likec4's).
 */
export function likec4BundleFresh(root, expected = likec4Stamp()) {
  if (!stampMatches(root, expected)) return false;
  let oldest = Number.POSITIVE_INFINITY;
  for (const output of likec4Projects(root).flatMap(outputsOf)) {
    try {
      oldest = Math.min(oldest, statSync(join(root, output)).mtimeMs);
    } catch {
      return false;
    }
  }
  return newestMtime(join(root, SOURCES), () => true) <= oldest;
}

/**
 * Writes a bundle per project in `root` and stamps them; a bundle of a project
 * no longer there, and the single bundle of the old layout, are removed first
 * so that nothing stale can be loaded. `run(root, bin, args)` spawns likec4.
 */
export function writeLikeC4Bundles(root, run = runLikeC4, likec4 = likec4Package()) {
  const projects = likec4Projects(root);
  const wanted = new Set(projects.flatMap(outputsOf));
  for (const legacy of LEGACY) rmSync(join(root, legacy), { force: true });
  mkdirSync(join(root, OUT_DIR), { recursive: true });
  for (const entry of readdirSync(join(root, OUT_DIR))) {
    if (!wanted.has(`${OUT_DIR}/${entry}`)) rmSync(join(root, OUT_DIR, entry), { force: true });
  }
  for (const project of projects) run(root, join(likec4.dir, "bin/likec4.mjs"), likec4ReactArgs(project));
  writeLikeC4Stamp(root, likec4Stamp(likec4.version));
  return projects;
}

/**
 * Writes the bundles in `root` unless they are fresh. Returns whether it ran;
 * throws when generation fails, since a site without its diagrams is not one
 * to serve. `run` stands in for the spawn in tests.
 */
export function ensureLikeC4Bundle(root, log = console.log, run = runLikeC4) {
  const likec4 = likec4Package();
  if (likec4BundleFresh(root, likec4Stamp(likec4.version))) return false;
  log(`likec4 ${likec4.version} → ${OUT_DIR}/ (missing, older than ${SOURCES}/, or from another likec4)`);
  writeLikeC4Bundles(root, run, likec4);
  return true;
}

function runLikeC4(root, bin, args) {
  // Its log is a page of debug lines on success, so it is kept for failure.
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(
      `likec4 ${args[0]} exited with ${result.status ?? result.signal ?? result.error?.message}${output ? `:\n${output}` : ""}`,
    );
  }
}

/** Vite plugin: the bundle is ensured once the root is known. */
export function likec4BundlePlugin() {
  return {
    name: "portolan:likec4-bundle",
    configResolved(config) {
      ensureLikeC4Bundle(config.root, (message) => config.logger.info(message));
    },
  };
}

/**
 * `likec4 validate` for every project: a workspace of several asks which one
 * to lay out, so each is named. Throws on the first that does not validate.
 */
export function validateLikeC4(root, run = runLikeC4, likec4 = likec4Package()) {
  for (const project of likec4Projects(root)) {
    run(root, join(likec4.dir, "bin/likec4.mjs"), ["validate", SOURCES, ...(project === UNNAMED ? [] : ["--project", project])]);
  }
}

// Run as a script: `npm run likec4:gen` writes every bundle now, and
// `npm run likec4:validate` (--validate) checks every project.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--validate")) {
    validateLikeC4(process.cwd());
    console.log(`likec4 validate: ${likec4Projects(process.cwd()).join(", ")} valid`);
  } else {
    const projects = writeLikeC4Bundles(process.cwd());
    console.log(`likec4 → ${projects.map(bundlePath).join(", ")}`);
  }
}
