// Runs the generators named in portolan.json.
//
//   node scripts/gen.mjs            write the output
//   node scripts/gen.mjs --check    fail if the output on disk is not what the
//                                   generators produce now
//
// The check mode is what makes generated documentation reviewable: the files
// are committed, so a change to them shows up in a diff like any other, and CI
// refuses a commit where they no longer follow from the catalog.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

import { loadCatalog } from "./catalog-sources.mjs";
import { runPlugin } from "./plugin-host.mjs";

const PORTOLAN_VERSION = "0.1.0";

// Every file a generator wrote last time is listed here, so a page that stops
// being generated is deleted instead of lingering as documentation of a service
// that no longer exists.
//
// The listing is keyed by step, not by directory. Two extractors writing
// fragments side by side into the same directory is the normal case - one knows
// the domain, the other the API - and a directory-wide list would have each of
// them delete the other's work on every run.
const MANIFEST = ".portolan-manifest";

const check = process.argv.includes("--check");

const manifest = JSON.parse(readFileSync("portolan.json", "utf8"));

let drifted = false;

// Extractors run first and write catalog fragments; only then is there a
// catalog for anything else to read. The two phases are declared separately in
// the manifest rather than ordered by hand, because "this step produces a
// source and that one consumes it" is a fact about the step, not about where
// somebody put it in a list.
for (const step of manifest.extract ?? []) {
  const plugin = pluginNamed(step.plugin);
  const stamp = stampFor(step.in);

  const { files, diagnostics } = await runPlugin(plugin, {
    portolanVersion: PORTOLAN_VERSION,
    input: { root: step.in, commit: stamp.commit, generatedAt: stamp.generatedAt },
    options: step.options ?? {},
  });

  report(diagnostics);
  drifted = summarise(`${step.plugin} ← ${step.in}`, files, apply(files, step.out, step.plugin, check)) || drifted;
}

const { catalog, sources, conflicts } = await loadSources();

console.log(
  `catalog: ${sources.length} source${sources.length === 1 ? "" : "s"} — ${sources
    .map((s) => `${s.path} @ ${s.commit || "?"}`)
    .join(", ")}`,
);

for (const conflict of conflicts) {
  console.warn(`  conflict  ${conflict.where}: ${conflict.message}`);
}

for (const step of manifest.generate ?? []) {
  const plugin = pluginNamed(step.plugin);

  const { files, diagnostics } = await runPlugin(plugin, {
    portolanVersion: PORTOLAN_VERSION,
    catalog,
    options: step.options ?? {},
  });

  report(diagnostics);
  drifted = summarise(`${step.plugin} → ${step.out}`, files, apply(files, step.out, step.plugin, check)) || drifted;
}

if (drifted) {
  console.error("\nGenerated documentation is out of date. Run `npm run gen`.");
  process.exit(1);
}

function pluginNamed(name) {
  const plugin = (manifest.plugins ?? []).find((p) => p.name === name);
  if (!plugin) {
    fail(`portolan.json: a step names plugin "${name}", which is not declared`);
  }

  return plugin;
}

function report(diagnostics) {
  for (const diagnostic of diagnostics) {
    const where = diagnostic.ref ? `${diagnostic.ref}: ` : "";
    console.warn(`  ${diagnostic.severity.padEnd(8)}${where}${diagnostic.message}`);
  }
}

/** Prints what a step did, and says whether it left the tree out of date. */
function summarise(label, files, changes) {
  const summary = `${label}: ${files.length} file${files.length === 1 ? "" : "s"}`;

  if (changes.length === 0) {
    console.log(`${summary}, up to date`);

    return false;
  }

  if (!check) {
    console.log(`${summary}, ${changes.length} written`);

    return false;
  }

  console.error(`${summary}, ${changes.length} out of date:`);
  for (const change of changes.slice(0, 20)) console.error(`  ${change}`);
  if (changes.length > 20) console.error(`  ... and ${changes.length - 20} more`);

  return true;
}

/**
 * When the source a fragment describes last changed, and at which commit.
 *
 * The host works this out rather than the extractor, for two reasons. A plugin
 * that reads a clock produces a different fragment on every run, which cannot
 * be committed and cannot be checked; and a plugin that shells out to git is a
 * plugin that can never be sandboxed. Stamped from the last commit to touch the
 * directory, a fragment changes exactly when its subject does.
 */
function stampFor(root) {
  for (const args of [
    ["log", "-1", "--format=%h %cI", "--", root],
    ["log", "-1", "--format=%h %cI"],
  ]) {
    try {
      const [commit, generatedAt] = execFileSync("git", args, { encoding: "utf8" }).trim().split(" ");
      if (commit && generatedAt) return { commit, generatedAt };
    } catch {
      // Not a repository, or no commit touches this path yet.
    }
  }

  return { commit: "uncommitted", generatedAt: new Date().toISOString() };
}

/** Reads, merges and validates every source the manifest names. */
async function loadSources() {
  try {
    return await loadCatalog();
  } catch (cause) {
    fail(cause.message);
  }
}

/**
 * Writes what the plugin asked for, and removes what it no longer asks for.
 * Returns a line per file that differs; in check mode nothing is touched.
 */
function apply(files, out, step, checkOnly) {
  const changes = [];
  const written = new Set();

  for (const file of files) {
    const target = safeJoin(out, file.name);
    written.add(file.name);

    let current = null;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      // Absent, which the comparison below reports as added.
    }

    if (current === file.contents) continue;

    changes.push(`${current === null ? "added   " : "changed "} ${join(out, file.name)}`);
    if (checkOnly) continue;

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents);
  }

  const listing = previous(out);
  const claimedByOthers = new Set(
    Object.entries(listing)
      .filter(([other]) => other !== step)
      .flatMap(([, names]) => names),
  );

  for (const stale of (listing[step] ?? []).filter(
    (name) => !written.has(name) && !claimedByOthers.has(name),
  )) {
    changes.push(`removed  ${join(out, stale)}`);
    if (checkOnly) continue;

    rmSync(safeJoin(out, stale), { force: true });
  }

  if (!checkOnly) {
    listing[step] = [...written].sort();
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, MANIFEST), `${JSON.stringify(listing, null, 2)}\n`);
    pruneEmptyDirs(out);
  }

  return changes;
}

/** What each step wrote into this directory last time. */
function previous(out) {
  try {
    const parsed = JSON.parse(readFileSync(join(out, MANIFEST), "utf8"));

    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Joins a plugin-supplied name onto the output directory, refusing anything
 * that would land outside it.
 *
 * This is the whole of a plugin's authority over the tree. A wasm plugin cannot
 * open a file at all; a process plugin very much can, and the names it hands
 * back are still not allowed to point anywhere they like.
 */
function safeJoin(out, name) {
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.includes("\\")) {
    fail(`plugin asked to write ${JSON.stringify(name)}, which is not a relative path`);
  }

  const target = resolve(out, normalize(name));
  const inside = relative(resolve(out), target);
  if (inside.startsWith("..") || inside.startsWith(sep)) {
    fail(`plugin asked to write ${JSON.stringify(name)}, which is outside ${out}`);
  }

  return target;
}

/** Removes directories left behind by files that are no longer generated. */
function pruneEmptyDirs(root) {
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return true;
    }

    let empty = true;
    for (const entry of entries) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (walk(path)) rmSync(path, { recursive: true, force: true });
        else empty = false;
      } else {
        empty = false;
      }
    }

    return empty;
  };

  walk(root);
}

function fail(message) {
  console.error(`portolan gen: ${message}`);
  process.exit(1);
}
