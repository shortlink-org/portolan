// Says whether the built plugins are newer than their sources, so that a run
// started from the page can skip building them.
//
// `npm run gen` builds the wasm and the Java extractor first, every time,
// which is right for a checkout somebody just changed and wrong for the
// fourth trial of a recording in a row: a minute of javac and the Go
// toolchain to learn nothing changed. The page asks here first and runs the
// generator alone when the answer is yes. Anything doubtful - a missing
// artefact, a source newer than it, a tree that cannot be read - is "no",
// and the build runs as it always did.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where the Go sources the wasm is built from live, relative to the workspace. */
const GO_ROOTS = ["plugins", "catalog", "plugin", "internal", "go.mod", "go.sum"];
const GO_WASM = "plugins/portolan-go.wasm";
const JAVA_SOURCES = "plugins/extract-java/src";
const JAVA_BUILD = "plugins/extract-java/build";

/** Directories under a source root that hold no sources of ours. */
const SKIP = new Set(["node_modules", "target", "build", "testdata", ".git", "vendor"]);

/**
 * The newest modification time under a path, counting only files whose
 * name passes `keep`, or -1 when nothing does. A path that cannot be read is
 * treated as newer than anything, which sends the caller down the safe road.
 */
export function newestMtime(root, keep) {
  let newest = -1;
  const pending = [root];
  while (pending.length) {
    const path = pending.pop();
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = readdirSync(path, { withFileTypes: true });
      } catch {
        return Number.POSITIVE_INFINITY;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && SKIP.has(entry.name)) continue;
        pending.push(join(path, entry.name));
      }
    } else if (keep(path)) {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

function oldestArtefact(root, keep) {
  let oldest = Number.POSITIVE_INFINITY;
  let any = false;
  const pending = [root];
  while (pending.length) {
    const path = pending.pop();
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) pending.push(join(path, entry.name));
    } else if (keep(path)) {
      any = true;
      oldest = Math.min(oldest, stat.mtimeMs);
    }
  }
  return any ? oldest : -1;
}

/**
 * Whether every built plugin is at least as new as every source it is built
 * from. `true` means `node scripts/gen.mjs` can run on its own; anything
 * else means `npm run gen`, which builds first.
 */
export function pluginsFresh(workspace) {
  const wasm = oldestArtefact(join(workspace, GO_WASM), () => true);
  if (wasm < 0) return false;
  const goSources = Math.max(
    ...GO_ROOTS.map((root) => newestMtime(join(workspace, root), (path) => /\.(go|mod|sum)$/.test(path))),
  );
  if (!(goSources <= wasm)) return false;

  const classes = oldestArtefact(join(workspace, JAVA_BUILD), (path) => path.endsWith(".class"));
  if (classes < 0) return false;
  const javaSources = newestMtime(join(workspace, JAVA_SOURCES), (path) => path.endsWith(".java"));
  return javaSources <= classes;
}
