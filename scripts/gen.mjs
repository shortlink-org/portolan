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
import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";

import {
  addBuildStep,
  createBuildReport,
  finishBuildReport,
  writeBuildReport,
} from "./build-report.mjs";
import { loadCatalog } from "./catalog-sources.mjs";
import { changedSince, fileAt, historyFor, lastCommitTouching } from "./history.mjs";
import { loadManifest, stepKeys } from "./manifest.mjs";
import { describePlugin, runPlugin } from "./plugin-host.mjs";
import { explainChange } from "./output-diff.mjs";
import {
  removeOutputFile,
  safeOutputPath,
  writeOutputFile,
} from "./output-path.mjs";
import { builtinPlugin } from "./builtin-plugins.mjs";
import { diagnoseWarnings } from "./warning-policy.mjs";

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
// What each plugin said it needs from the host (portolan.0007), by name.
const pluginNeeds = new Map();

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
  //
  // No stamp travels with the request (portolan.0010). A fragment is content
  // and nothing else; when it last changed is what the history of the
  // fragment says, read wherever the catalog is read.
  for (const step of manifest.extract ?? []) {
    const plugin = pluginNamed(step.plugin);
    // A plugin that asks for history gets the root's, read once per checkout
    // (portolan.0007); left out when the root is not in a checkout, which the
    // plugin reports in its own words.
    const history = (await needsOf(plugin)).has("history") ? historyFor(process.cwd(), step.in) : undefined;
    await executeStep("extract", step, `${step.plugin} ← ${step.in}`, async () =>
      runPlugin(plugin, {
        portolanVersion: PORTOLAN_VERSION,
        input: {
          root: step.in,
          output: step.out,
          ...(history ? { history } : {}),
        },
        options: step.options ?? {},
      }, {}, { workspace: process.cwd() }),
    inputsOf(step));
  }

  // Verifiers read observed evidence against the merged catalog while leaving
  // their own previous output out of that evidence - and what a dropped
  // extract step wrote, which is still on disk because the sweep runs once
  // every step has written. Read into this merge, a service nobody extracts
  // any more would be written back into an overlay, and the overlay would
  // carry it into the generators and into the next run.
  for (const step of manifest.verify ?? []) {
    const plugin = pluginNamed(step.plugin);
    const own = (previous(step.out)[keys.keyOf(step)] ?? []).map((name) => join(step.out, name));
    const { catalog, sources } = await loadSources({ exclude: [...own, ...staleAll()] });
    await executeStep("verify", step, `${step.plugin} ⇐ ${step.in}`, async () =>
      runPlugin(plugin, {
        portolanVersion: PORTOLAN_VERSION,
        input: { root: step.in, output: step.out },
        catalog,
        options: step.options ?? {},
      }, {}, { workspace: process.cwd() }),
    inputsOf(step, sources.map((source) => source.path)));
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
    const generated = step.catalog
      ? await loadSources({ profile: step.catalog })
      : { catalog, sources };
    await executeStep("generate", step, `${step.plugin} → ${step.out}`, async () =>
      runPlugin(plugin, {
        portolanVersion: PORTOLAN_VERSION,
        catalog: generated.catalog,
        options: step.options ?? {},
      }),
    { inputs: generated.sources.map((source) => source.path), excludes: [] });
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

/**
 * Runs one step and settles its files. `reads` is what the step reads - paths,
 * and the output directories among them to leave out - so that an output
 * that moved can be explained by what moved among its inputs since the
 * output was last committed.
 */
async function executeStep(phase, step, label, work, reads) {
  const startedAt = Date.now();
  event({ type: "step-started", ordinal: report.steps.length, phase, plugin: step.plugin, input: step.in, output: step.out });
  try {
    const { files, warnings = [] } = await work();
    const diagnostics = diagnoseWarnings({
      plugin: step.plugin,
      warnings,
      policies: manifest.warningPolicies,
      project: projectForStep(step),
      phase,
    });
    const changes = apply(files, step.out, keys.keyOf(step), check);
    const since = changes.length > 0 ? whyChanged(step, files.map((file) => join(step.out, file.name)), reads) : null;
    const changed = summarise(label, files, changes, diagnostics, since);
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
      // What moved among the inputs since the output was last committed, when
      // something in the output moved; the Settings page can say why.
      ...(since ? { since } : {}),
      files: files.map((file) => join(step.out, file.name)),
      // What the plugin could not read, in its own words. Already printed as
      // it ran; kept here so the Settings page can list it beside the step.
      warnings,
      diagnostics,
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

function projectForStep(step) {
  if (!step.in) return "";
  const input = String(step.in).replace(/\\/g, "/").replace(/\/+$/, "");
  const projects = (manifest.projects ?? [])
    .filter((project) => typeof project?.id === "string" && typeof project?.root === "string")
    .sort((left, right) => right.root.length - left.root.length);
  return projects.find((project) => input === project.root || input.startsWith(`${project.root}/`))?.id ?? "";
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

/**
 * What a plugin's descriptor says it needs from the host, asked once per
 * plugin per run. A plugin that does not describe itself needs nothing it
 * could be given.
 */

async function needsOf(plugin) {
  if (!pluginNeeds.has(plugin.name)) {
    let descriptor = null;
    try {
      descriptor = await describePlugin(plugin);
    } catch {
      // A plugin that cannot answer describe cannot ask for anything either;
      // whatever is wrong with it, the step itself will say.
    }
    pluginNeeds.set(plugin.name, new Set(descriptor?.needs ?? []));
  }
  return pluginNeeds.get(plugin.name);
}

/**
 * Prints what a step did, and says whether it left the tree out of date. A
 * file that differs says where it first differs, and the step says what moved
 * among its inputs since the output was last committed - or that nothing
 * did, which points at the plugin.
 */
function summarise(label, files, changes, diagnostics = [], since = null) {
  const suppressed = diagnostics.filter((diagnostic) => diagnostic.suppressed).length;
  const said = diagnostics.length > 0
    ? `, ${diagnostics.length} warning${diagnostics.length === 1 ? "" : "s"}${suppressed ? ` (${suppressed} suppressed)` : ""}`
    : "";
  const summary = `${label}: ${files.length} file${files.length === 1 ? "" : "s"}${said}`;

  if (changes.length === 0) {
    console.log(`${summary}, up to date`);

    return false;
  }

  if (!check) {
    console.log(`${summary}, ${changes.length} written`);
    if (since) console.log(`  ${describeSince(since)}`);

    return false;
  }

  console.error(`${summary}, ${changes.length} out of date:`);
  for (const change of changes.slice(0, 20)) {
    console.error(`  ${change.kind.padEnd(8)} ${change.path}${change.reason ? ` — ${change.reason}` : ""}`);
  }
  if (changes.length > 20) console.error(`  ... and ${changes.length - 20} more`);
  if (since) console.error(`  ${describeSince(since)}`);

  return true;
}

/**
 * What a step reads, for saying why its output moved: its root and whatever
 * else it was handed, less every output directory inside the root, because a
 * fragment written beside the code it describes is not an input to itself.
 */
function inputsOf(step, extra = []) {
  const excludes = [];
  for (const other of allSteps()) {
    if (!other.out || other.out === step.in) continue;
    const inside = relative(step.in, other.out);
    if (inside && !inside.startsWith("..") && !isAbsolute(inside)) excludes.push(other.out);
  }
  return { inputs: [step.in, ...extra], excludes };
}

function allSteps() {
  return [...(manifest.extract ?? []), ...(manifest.verify ?? []), ...(manifest.generate ?? [])];
}

/**
 * Why a step's output is not what it was: the commit that last touched the
 * output is when it was last generated, and what changed among the inputs
 * since then is the reason. The history is the record of the last generation
 * (portolan.0010); nothing is written down to know this.
 *
 * The manifest counts as an input only where this step's own entry moved.
 * The whole file changes whenever any step is touched, and naming it for
 * every other step would explain nothing.
 */
function whyChanged(step, outputs, reads) {
  const committed = lastCommitTouching(process.cwd(), outputs);
  if (!committed) return { committed: null, changed: [] };
  const changed = changedSince(process.cwd(), committed.commit, reads.inputs, reads.excludes);
  if (stepEntryChanged(committed.commit, step)) changed.push("portolan.json (this step's entry)");
  return { committed, changed };
}

/** Whether the manifest at `commit` told this step the same thing it is told now. */
function stepEntryChanged(commit, step) {
  let then;
  try {
    then = JSON.parse(fileAt(process.cwd(), commit, "portolan.json"));
  } catch {
    return true; // No manifest there, or not one that parses: everything about the step is new.
  }
  const phase = ["extract", "verify", "generate"].find((name) => (manifest[name] ?? []).includes(step));
  const before = (then[phase] ?? []).find(
    (other) =>
      other.plugin === step.plugin &&
      (other.in ?? "") === (step.in ?? "") &&
      other.out === step.out &&
      (other.options?.out ?? "") === (step.options?.out ?? ""),
  );
  return !before || JSON.stringify(before) !== JSON.stringify(step);
}

function describeSince({ committed, changed }) {
  if (!committed) return "the output has never been committed, so there is nothing to compare its inputs against";
  const when = `${committed.commit} (${committed.date}), when the output was last committed`;
  if (changed.length === 0) return `no input changed since ${when}; the plugin itself did`;
  const shown = changed.slice(0, 6).join(", ");
  const more = changed.length > 6 ? ` and ${changed.length - 6} more` : "";
  return `since ${when}, ${changed.length} input${changed.length === 1 ? "" : "s"} changed: ${shown}${more}`;
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
    const binary = file.encoding === "base64";
    const wanted = binary ? Buffer.from(file.contents, "base64") : file.contents;

    let current = null;
    try {
      current = readFileSync(target, binary ? undefined : "utf8");
    } catch {
      // Absent, which the comparison below reports as added.
    }

    if (binary ? Buffer.isBuffer(current) && current.equals(wanted) : current === wanted) continue;

    changes.push({
      kind: current === null ? "added" : "changed",
      path: join(out, file.name),
      reason: explainChange(current, wanted, file.name),
    });
    if (checkOnly) continue;

    try {
      writeOutputFile(out, file.name, wanted);
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
