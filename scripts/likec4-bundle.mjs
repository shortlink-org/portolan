// Writes the LikeC4 react bundle when it is missing or older than likec4/.
//
// src/likec4/generated.jsx is imported by the diagrams and is not committed:
// it follows from the committed likec4/ sources and weighs a megabyte. A
// fresh checkout or worktree has none, and `npx vite` there fails on the
// first page that draws a view. The Vite config asks here before it serves
// or builds, so nobody has to remember `likec4 gen react` first.
//
// Only the react step runs: likec4/ itself is written by `npm run gen` (and
// `npm run likec4:gen`) and held to the catalog by `gen:check`. Deciding
// costs a few stats; a bundle at least as new as every file under likec4/ is
// left alone. `portolan dev` and `portolan build` generate into their stage
// right before Vite starts, so there the answer is always "fresh".

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { newestMtime } from "./plugins-fresh.mjs";

const SOURCES = "likec4";
const OUTPUT = "src/likec4/generated.jsx";
const OUTPUTS = [OUTPUT, "src/likec4/generated.d.ts"];

/** Whether both generated files exist and are no older than likec4/. */
export function likec4BundleFresh(root) {
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
 * Runs `likec4 gen react` in `root` unless the bundle is fresh. Returns
 * whether it ran; throws when generation fails, since a site without its
 * diagrams is not one to serve.
 */
export function ensureLikeC4Bundle(root, log = console.log) {
  if (likec4BundleFresh(root)) return false;
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve("likec4/package.json")), "bin/likec4.mjs");
  log(`likec4 → ${OUTPUT} (missing or older than ${SOURCES}/)`);
  // --no-use-dot: the wasm layout engine, not a graphviz binary that may be
  // absent (see generateLikeC4 in cli/portolan.mjs).
  // Its log is a page of debug lines on success, so it is kept for failure.
  const result = spawnSync(process.execPath, [bin, "gen", "react", SOURCES, "-o", OUTPUT, "--no-use-dot"], {
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
  return true;
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
