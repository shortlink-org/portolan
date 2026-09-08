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
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

import {
  addBuildStep,
  createBuildReport,
  finishBuildReport,
  writeBuildReport,
} from "./build-report.mjs";
import { loadCatalog } from "./catalog-sources.mjs";
import { loadManifest, stepKeys } from "./manifest.mjs";
import { runPlugin } from "./plugin-host.mjs";
import { vendoredCommit } from "./vendor-lock.mjs";
import {
  removeOutputFile,
  safeOutputPath,
  writeOutputFile,
} from "./output-path.mjs";
import { builtinPlugin } from "./builtin-plugins.mjs";

const PORTOLAN_VERSION = "0.1.0";
const EVENTS = process.env.PORTOLAN_EVENTS === "1";
const EVENT_PREFIX = "::portolan-event::";

function event(value) {
  if (EVENTS) process.stdout.write(`${EVENT_PREFIX}${JSON.stringify(value)}\n`);
}

// Every file a generator wrote last time is listed here, so a page that stops
// being generated is deleted instead of lingering as documentation of a service
// that no longer exists.
//
// The listing is keyed by step, not by directory. Two extractors writing
// fragments side by side into the same directory is the normal case - one knows
// the domain, the other the API - and a directory-wide list would have each of
// them delete the other's work on every run. What names a step is decided in
// manifest.mjs: its plugin, and the file it names when two steps of one plugin
// share a directory.
//
// A key that no step of this run answers to belonged to a step that was taken
// out of the manifest or renamed. Its files are as stale as any other, and they
// are removed once every step has run - not before, because a renamed step
// writes the same files under its new key, and a file removed and written back
// in one run is drift that never happened.
const MANIFEST = ".portolan-manifest";

const check = process.argv.includes("--check");
const manifestSha256 = createHash("sha256")
  .update(readFileSync("portolan.json"))
  .digest("hex");
const report = createBuildReport({
  mode: check ? "check" : "write",
  manifestSha256,
});
let manifest = {};
let keys = stepKeys({});
let drifted = false;

// What each step wrote into each directory on this run, by key. The listing
// on disk says what was written last time; in check mode it is never updated,
// so the sweep at the end reads this rather than the file.
const wroteThisRun = new Map();

// Directories already swept this run; a second pass would report the same
// removals again in check mode.
const swept = new Set();

try {
  persistReport();
  await generate();
  finishBuildReport(report, drifted ? "drifted" : "ok");
  persistReport();
  event({ type: "run-finished", status: report.status, durationMs: report.durationMs });
  if (drifted) {
    console.error("\nGenerated documentation is out of date. Run `npm run gen`.");
    process.exitCode = 1;
  }
} catch (cause) {
  finishBuildReport(report, "failed");
  persistReport();
  event({ type: "run-finished", status: "failed", durationMs: report.durationMs, message: cause instanceof Error ? cause.message : String(cause) });
  console.error(`portolan gen: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
}

async function generate() {
  // Checked before anything runs, against the schema the plugins describe. A
  // step with a misspelled option would otherwise run to completion and write a
  // fragment missing whatever that option was for.
  const loaded = loadManifest("portolan.json");
  manifest = loaded.manifest;
  if (loaded.problems.length > 0) {
    throw new Error(
      `portolan.json does not match schema/portolan.schema.json:\n${loaded.problems
        .map((problem) => `  ${problem}`)
        .join("\n")}`,
    );
  }
  keys = stepKeys(manifest);
  event({ type: "pipeline-ready", stepCount: (manifest.extract?.length ?? 0) + (manifest.verify?.length ?? 0) + (manifest.generate?.length ?? 0) });

  // Extractors run first and write catalog fragments; only then is there a
  // catalog for anything else to read.
  for (const step of manifest.extract ?? []) {
    const plugin = pluginNamed(step.plugin);
    const stamp = stampFor(step.in, step.out);
    await executeStep("extract", step, `${step.plugin} ← ${step.in}`, async () =>
      runPlugin(plugin, {
        portolanVersion: PORTOLAN_VERSION,
        input: { root: step.in, output: step.out, commit: stamp.commit, generatedAt: stamp.generatedAt },
        options: step.options ?? {},
      }),
    );
  }

  // Verifiers read observed evidence against the merged catalog while leaving
  // their own previous output out of that evidence - and what a dropped
  // extract step wrote, which is still on disk because the sweep runs once
  // every step has written. Read into this merge, a service nobody extracts
  // any more would be written back into an overlay, and the overlay would
  // carry it into the generators and into the next run.
  for (const step of manifest.verify ?? []) {
    const plugin = pluginNamed(step.plugin);
    const stamp = stampFor(step.in, step.out);
    const own = (previous(step.out)[keys.keyOf(step)] ?? []).map((name) => join(step.out, name));
    const { catalog } = await loadSources({ exclude: [...own, ...staleAll()] });
    await executeStep("verify", step, `${step.plugin} ⇐ ${step.in}`, async () =>
      runPlugin(plugin, {
        portolanVersion: PORTOLAN_VERSION,
        input: { root: step.in, output: step.out, commit: stamp.commit, generatedAt: stamp.generatedAt },
        catalog,
        options: step.options ?? {},
      }),
    );
  }

  // What a dropped extract step wrote is not part of the catalog, so it is
  // swept before the catalog is read - not after, when the generators would
  // already have documented it once more.
  sweepAll();

  const { catalog, sources, conflicts } = await loadSources();
  console.log(
    `catalog: ${sources.length} source${sources.length === 1 ? "" : "s"} — ${sources
      .map((source) => `${source.path} @ ${source.commit || "?"}`)
      .join(", ")}`,
  );
  for (const conflict of conflicts) {
    console.warn(`  conflict  ${conflict.where}: ${conflict.message}`);
  }

  for (const step of manifest.generate ?? []) {
    const plugin = pluginNamed(step.plugin);
    const generatedCatalog = step.catalog
      ? (await loadSources({ profile: step.catalog })).catalog
      : catalog;
    await executeStep("generate", step, `${step.plugin} → ${step.out}`, async () =>
      runPlugin(plugin, {
        portolanVersion: PORTOLAN_VERSION,
        catalog: generatedCatalog,
        options: step.options ?? {},
      }),
    );
  }

  sweepAll();
}

function sweepAll() {
  for (const out of wroteThisRun.keys()) {
    if (swept.has(out)) continue;
    swept.add(out);
    const changes = sweep(out, check);
    if (changes.length > 0) {
      drifted = summarise(`${out}: steps no longer in portolan.json`, [], changes) || drifted;
    }
  }
}

/** Every file the sweep would remove, in every directory a step writes into. */
function staleAll() {
  const outs = new Set(
    [...(manifest.extract ?? []), ...(manifest.verify ?? []), ...(manifest.generate ?? [])].map(
      (step) => step.out,
    ),
  );
  const stale = [];
  for (const out of outs) {
    for (const name of staleIn(out)) stale.push(join(out, name));
  }
  return stale;
}

/**
 * What the steps no longer in the manifest wrote into a directory and no live
 * step claims. A file a dead key listed and a live step wrote again this run
 * is not stale - it was renamed, not dropped - and a live step that has not
 * run yet is taken at its previous listing.
 */
function staleIn(out) {
  const listing = previous(out);
  const live = keys.liveIn(out);
  const dead = Object.keys(listing).filter((key) => !live.has(key));
  if (dead.length === 0) return [];

  const kept = new Set();
  for (const key of live) {
    for (const name of wroteThisRun.get(out)?.get(key) ?? listing[key] ?? []) kept.add(name);
  }
  const stale = [];
  for (const key of dead) {
    for (const name of listing[key]) {
      if (kept.has(name)) continue;
      kept.add(name);
      stale.push(name);
    }
  }
  return stale;
}

async function executeStep(phase, step, label, work) {
  const startedAt = Date.now();
  event({ type: "step-started", ordinal: report.steps.length, phase, plugin: step.plugin, input: step.in, output: step.out });
  try {
    const { files, warnings = [] } = await work();
    const changes = apply(files, step.out, keys.keyOf(step), check);
    const changed = summarise(label, files, changes, warnings);
    drifted = changed || drifted;
    const result = {
      phase,
      plugin: step.plugin,
      ...(step.in ? { input: step.in } : {}),
      output: step.out,
      status: changed ? "drifted" : changes.length > 0 ? "written" : "up-to-date",
      durationMs: Date.now() - startedAt,
      fileCount: files.length,
      changedCount: changes.length,
      changes,
      files: files.map((file) => join(step.out, file.name)),
      // What the plugin could not read, in its own words. Already printed as
      // it ran; kept here so the Settings page can list it beside the step.
      warnings,
    };
    addBuildStep(report, result);
    persistReport();
    event({ type: "step-finished", ordinal: report.steps.length - 1, ...result });
  } catch (cause) {
    const result = {
      phase,
      plugin: step.plugin,
      ...(step.in ? { input: step.in } : {}),
      output: step.out,
      status: "failed",
      durationMs: Date.now() - startedAt,
      fileCount: 0,
      changedCount: 0,
      changes: [],
      files: [],
      warnings: [],
    };
    addBuildStep(report, result);
    persistReport();
    event({ type: "step-finished", ordinal: report.steps.length - 1, ...result, message: cause instanceof Error ? cause.message : String(cause) });
    throw cause;
  }
}

function persistReport() {
  try {
    writeBuildReport(report);
  } catch (cause) {
    console.warn(`portolan gen: could not write build report: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function pluginNamed(name) {
  const plugin = (manifest.plugins ?? []).find((p) => p.name === name);
  const shipped = builtinPlugin(name);
  if (!plugin && !shipped) {
    fail(`portolan.json: a step names plugin "${name}", which is not declared`);
  }

  return plugin ?? shipped;
}

/** Prints what a step did, and says whether it left the tree out of date. */
function summarise(label, files, changes, warnings = []) {
  const said = warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
  const summary = `${label}: ${files.length} file${files.length === 1 ? "" : "s"}${said}`;

  if (changes.length === 0) {
    console.log(`${summary}, up to date`);

    return false;
  }

  if (!check) {
    console.log(`${summary}, ${changes.length} written`);

    return false;
  }

  console.error(`${summary}, ${changes.length} out of date:`);
  for (const change of changes.slice(0, 20)) console.error(`  ${change.kind.padEnd(8)} ${change.path}`);
  if (changes.length > 20) console.error(`  ... and ${changes.length - 20} more`);

  return true;
}

/**
 * When the source a fragment describes last changed, and at which commit
 * (portolan.0002).
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
  // A copy of another repository is dated by the commit it is a copy OF, which
  // the fetch step wrote down beside it. Read before git, and without touching
  // git at all: the local history of a vendored directory says when somebody
  // ran the fetch, which is a fact about this repository and not about the
  // service the fragment describes.
  //
  // Short, like every other stamp, because a stamp is read rather than
  // resolved. The full sha travels separately, in the pin the fetch also
  // wrote, where a link is built from it.
  const vendored = vendoredCommit(root);
  if (vendored) {
    // No date. Nothing here knows when that commit was made - the lock records
    // what was fetched, not when it was authored - and a date invented from
    // the local clock would make the merge call this the stalest source in the
    // estate every time it ran.
    return { commit: vendored.slice(0, 7), generatedAt: "" };
  }

  // The history read is the one the root lives in. A manifest pointed at a
  // checkout elsewhere on the disk - the service being documented, not a copy
  // of it vendored here - is stamped from that checkout's history, because the
  // fragment describes that service and not the repository the manifest sits
  // in. A root with no repository around it is stamped as uncommitted.
  const repo = repositoryOf(root);
  if (!repo) {
    return { commit: "uncommitted", generatedAt: process.env.PORTOLAN_GENERATED_AT || new Date().toISOString() };
  }

  // A shallow clone has no history to read: the one commit that was fetched has
  // no parent, so every path looks as though it changed there and every fragment
  // is stamped with the checkout rather than with its subject. That is wrong
  // quietly - the fragments regenerate, `--check` reports drift, and nothing
  // says why - so it is refused here instead.
  if (shallow(repo)) {
    fail(
      `${repo} is a shallow clone, where every path looks as though it changed in ` +
        "the single commit that was fetched, so a fragment cannot be stamped " +
        "with the commit it describes. Fetch the full history first " +
        "(git fetch --unshallow, or actions/checkout with fetch-depth: 0).",
    );
  }

  // Only an output INSIDE the root is excluded. An output beside it, or above
  // it, is not in the root's history to begin with - and excluding a parent
  // would exclude the root itself, leaving nothing to read and a stamp that
  // moved on every commit.
  const rootInRepo = relative(repo, resolve(root)) || ".";
  const outInRepo = out ? relative(repo, resolve(out)) : "";
  const inside = out && (outInRepo === rootInRepo || outInRepo.startsWith(`${rootInRepo.replace(/\/$/, "")}/`) || rootInRepo === ".");
  const exclude = inside && outInRepo !== rootInRepo && !outInRepo.startsWith("..") ? [`:(exclude)${outInRepo}`] : [];

  for (const args of [
    ["log", "-1", "--format=%h %cI", "--", rootInRepo, ...exclude],
    ["log", "-1", "--format=%h %cI"],
  ]) {
    const answer = git(repo, args);
    if (!answer) continue;
    const [commit, generatedAt] = answer.split(" ");
    if (commit && generatedAt) return { commit, generatedAt };
  }

  return { commit: "uncommitted", generatedAt: process.env.PORTOLAN_GENERATED_AT || new Date().toISOString() };
}

/** Runs git in a repository and answers with its trimmed output, or "" when it refused. */
function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a repository, or no commit touches this path yet. git has already
    // said so on its own stderr, which is not this run's log.
    return "";
  }
}

/** The working tree a directory belongs to, or "" when no repository holds it. */
function repositoryOf(dir) {
  return git(dir, ["rev-parse", "--show-toplevel"]);
}

/** Whether the history this runs against is truncated. */
function shallow(repo) {
  return git(repo, ["rev-parse", "--is-shallow-repository"]) === "true";
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
function apply(files, out, key, checkOnly) {
  const changes = [];
  const written = new Set();
  if (!wroteThisRun.has(out)) wroteThisRun.set(out, new Map());
  wroteThisRun.get(out).set(key, written);

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

    changes.push({ kind: current === null ? "added" : "changed", path: join(out, file.name) });
    if (checkOnly) continue;

    try {
      writeOutputFile(out, file.name, file.contents);
    } catch (cause) {
      fail(cause.message);
    }
  }

  const listing = previous(out);
  const claimedByOthers = new Set(
    Object.entries(listing)
      .filter(([other]) => other !== key)
      .flatMap(([, names]) => names),
  );

  for (const stale of (listing[key] ?? []).filter(
    (name) => !written.has(name) && !claimedByOthers.has(name),
  )) {
    changes.push({ kind: "removed", path: join(out, stale) });
    if (checkOnly) continue;

    try {
      removeOutputFile(out, stale);
    } catch (cause) {
      fail(cause.message);
    }
  }

  if (!checkOnly) {
    listing[key] = [...written].sort();
    try {
      writeOutputFile(out, MANIFEST, `${JSON.stringify(listing, null, 2)}\n`);
    } catch (cause) {
      fail(cause.message);
    }
    pruneEmptyDirs(out);
  }

  return changes;
}

/**
 * Removes what the steps that are no longer in the manifest wrote into a
 * directory, and forgets them. Runs after every step has written, so a file a
 * dead key listed and a live step wrote again this run is kept - it was
 * renamed, not dropped.
 */
function sweep(out, checkOnly) {
  const changes = [];
  const listing = previous(out);
  const live = keys.liveIn(out);
  const dead = Object.keys(listing).filter((key) => !live.has(key));
  if (dead.length === 0) return changes;

  for (const stale of staleIn(out)) {
    changes.push({ kind: "removed", path: join(out, stale) });
    if (checkOnly) continue;

    try {
      removeOutputFile(out, stale);
    } catch (cause) {
      fail(cause.message);
    }
  }
  for (const key of dead) delete listing[key];

  if (!checkOnly) {
    try {
      writeOutputFile(out, MANIFEST, `${JSON.stringify(listing, null, 2)}\n`);
    } catch (cause) {
      fail(cause.message);
    }
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
  try {
    return safeOutputPath(out, name);
  } catch (cause) {
    fail(cause.message);
  }
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
      if (lstatSync(path).isSymbolicLink()) {
        empty = false;
      } else if (statSync(path).isDirectory()) {
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
  throw new Error(message);
}
