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
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

import { loadCatalog } from "./catalog-sources.mjs";
import { loadManifest } from "./manifest.mjs";
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

// Checked before anything runs, against the schema the plugins describe. A
// step with a misspelled option would otherwise run to completion and write a
// fragment missing whatever that option was for, which is the kind of wrong
// that is only noticed on the page weeks later.
const { manifest, problems } = loadManifest("portolan.json");
if (problems.length > 0) {
  console.error("portolan.json does not match schema/portolan.schema.json:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

let drifted = false;

// Extractors run first and write catalog fragments; only then is there a
// catalog for anything else to read. The phases are declared separately in
// the manifest rather than ordered by hand, because "this step produces a
// source and that one consumes it" is a fact about the step, not about where
// somebody put it in a list.
for (const step of manifest.extract ?? []) {
  const plugin = pluginNamed(step.plugin);
  const stamp = stampFor(step.in, step.out);

  const { files } = await runPlugin(plugin, {
    portolanVersion: PORTOLAN_VERSION,
    input: { root: step.in, commit: stamp.commit, generatedAt: stamp.generatedAt },
    options: step.options ?? {},
  });

  drifted = summarise(`${step.plugin} ← ${step.in}`, files, apply(files, step.out, step.plugin, check)) || drifted;
}

// Verifiers run between the two. They read something observed - traces, a
// test's record - and answer with a fragment too, but a fragment that only
// makes sense against the merged catalog: "this hop was seen running" names a
// hop somebody else declared. So a verifier is handed the catalog AND a root,
// and the catalog it is handed leaves out the verifier's own last output.
// Without that, what it wrote last time would count as evidence this time,
// and the fragment could never be checked against a clean run.
for (const step of manifest.verify ?? []) {
  const plugin = pluginNamed(step.plugin);
  const stamp = stampFor(step.in, step.out);
  const own = (previous(step.out)[step.plugin] ?? []).map((name) => join(step.out, name));
  const { catalog } = await loadSources({ exclude: own });
  const { files } = await runPlugin(plugin, {
    portolanVersion: PORTOLAN_VERSION,
    input: { root: step.in, commit: stamp.commit, generatedAt: stamp.generatedAt },
    catalog,
    options: step.options ?? {},
  });
  drifted = summarise(`${step.plugin} ⇐ ${step.in}`, files, apply(files, step.out, step.plugin, check)) || drifted;
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

  const { files } = await runPlugin(plugin, {
    portolanVersion: PORTOLAN_VERSION,
    catalog,
    options: step.options ?? {},
  });

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
 *
 * The output is excluded from that history, and it has to be: a fragment
 * written beside the code it describes is inside the directory it is stamped
 * from, so committing one would move the stamp, which would make the fragment
 * out of date, which would rewrite it - and `--check` would never come back
 * clean two runs in a row.
 */
function stampFor(root, out) {
  // A shallow clone has no history to read: the one commit that was fetched has
  // no parent, so every path looks as though it changed there and every fragment
  // is stamped with the checkout rather than with its subject. That is wrong
  // quietly - the fragments regenerate, `--check` reports drift, and nothing
  // says why - so it is refused here instead.
  if (shallow()) {
    fail(
      "this is a shallow clone, where every path looks as though it changed in " +
        "the single commit that was fetched, so a fragment cannot be stamped " +
        "with the commit it describes. Fetch the full history first " +
        "(git fetch --unshallow, or actions/checkout with fetch-depth: 0).",
    );
  }

  // Only an output INSIDE the root is excluded. An output beside it, or above
  // it, is not in the root's history to begin with - and excluding a parent
  // would exclude the root itself, leaving nothing to read and a stamp that
  // moved on every commit.
  const inside = out && (out === root || out.startsWith(`${root.replace(/\/$/, "")}/`));
  const exclude = inside && out !== root ? [`:(exclude)${out}`] : [];

  for (const args of [
    ["log", "-1", "--format=%h %cI", "--", root, ...exclude],
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

/** Whether the history this runs against is truncated. */
function shallow() {
  try {
    return execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      encoding: "utf8",
    }).trim() === "true";
  } catch {
    // Not a repository at all, which stampFor already falls back for.
    return false;
  }
}

/** Reads, merges and validates every source the manifest names. */
async function loadSources(options = {}) {
  try {
    return await loadCatalog("portolan.json", options);
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

  // A lexically safe name can still escape through an existing symlink in the
  // output tree. Refuse every symlink component before reading, writing or
  // deleting the target.
  let current = resolve(out);
  for (const part of ["", ...inside.split(sep)]) {
    if (part) current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        fail(`plugin asked to use ${JSON.stringify(name)}, but ${current} is a symlink`);
      }
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
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
