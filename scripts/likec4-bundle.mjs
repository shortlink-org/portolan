// Writes the LikeC4 react bundle when it is missing, older than likec4/, or
// written by another generator.
//
// src/likec4/generated.jsx is imported by the diagrams and is not committed:
// it follows from the committed likec4/ sources and weighs a megabyte. A
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
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { newestMtime } from "./plugins-fresh.mjs";

const SOURCES = "likec4";
const OUTPUT = "src/likec4/generated.jsx";
const OUTPUTS = [OUTPUT, "src/likec4/generated.d.ts"];
export const STAMP = "src/likec4/generated.stamp.json";

/**
 * The arguments to likec4's bin that write the bundle. --no-use-dot: the wasm
 * layout engine, not a graphviz binary that may be absent (inside a container
 * likec4 switches to one by default and, finding none, reports "no views").
 */
export const LIKEC4_REACT_ARGS = ["gen", "react", SOURCES, "-o", OUTPUT, "--no-use-dot"];

/**
 * The installed likec4 package, resolved like any import from here rather than
 * at ./node_modules/.bin, which a git worktree sharing its parent checkout's
 * node_modules does not have.
 */
function likec4Package() {
  const manifest = createRequire(import.meta.url).resolve("likec4/package.json");
  return { dir: dirname(manifest), version: JSON.parse(readFileSync(manifest, "utf8")).version };
}

/** What the stamp says of a bundle written by likec4 `version` with today's arguments. */
export function likec4Stamp(version = likec4Package().version) {
  return { likec4: version, args: LIKEC4_REACT_ARGS };
}

/** Records that the bundle in `root` was just written by `stamp`'s generator. */
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
 * Whether both generated files exist, are no older than likec4/, and carry a
 * stamp equal to `expected` (by default, the installed likec4's).
 */
export function likec4BundleFresh(root, expected = likec4Stamp()) {
  if (!stampMatches(root, expected)) return false;
  let oldest = Number.POSITIVE_INFINITY;
  for (const output of OUTPUTS) {
    try {
      oldest = Math.min(oldest, statSync(join(root, output)).mtimeMs);
    } catch {
      return false;
    }
  }
  return newestMtime(join(root, SOURCES), () => true) <= oldest;
}

/**
 * Runs `likec4 gen react` in `root` unless the bundle is fresh, then stamps
 * it. Returns whether it ran; throws when generation fails, since a site
 * without its diagrams is not one to serve. `run(root, bin)` stands in for
 * the spawn in tests.
 */
export function ensureLikeC4Bundle(root, log = console.log, run = runLikeC4) {
  const likec4 = likec4Package();
  const stamp = likec4Stamp(likec4.version);
  if (likec4BundleFresh(root, stamp)) return false;
  log(`likec4 ${likec4.version} → ${OUTPUT} (missing, older than ${SOURCES}/, or from another likec4)`);
  run(root, join(likec4.dir, "bin/likec4.mjs"));
  writeLikeC4Stamp(root, stamp);
  return true;
}

function runLikeC4(root, bin) {
  // Its log is a page of debug lines on success, so it is kept for failure.
  const result = spawnSync(process.execPath, [bin, ...LIKEC4_REACT_ARGS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(
      `likec4 gen react exited with ${result.status ?? result.signal ?? result.error?.message}${output ? `:\n${output}` : ""}`,
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
