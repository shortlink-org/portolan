#!/usr/bin/env node
// Branch drafts in dev (portolan.0019): generate, list and delete the draft of
// one project on one branch.
//
// A draft is generated from two detached worktrees of the repository - the
// branch's tip and its merge-base with main - each with the project's extract
// steps run over it, so both sides are read by the extractors of this
// checkout rather than by whatever fragments happened to be committed. The two
// catalogs are compared by entity and the result is saved under
// portolan-drafts/, beside the catalog the site is built from.
//
//   node scripts/branch-drafts.mjs branches
//   node scripts/branch-drafts.mjs list
//   node scripts/branch-drafts.mjs generate --project auth --branch demo/auth-passkeys
//   node scripts/branch-drafts.mjs delete --project auth --branch demo/auth-passkeys

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import reserved from "../src/likec4/reserved.json" with { type: "json" };

export const DRAFTS_DIR = "portolan-drafts";

const EVENT_PREFIX = "::portolan-event::";
// The protocol version gen speaks to plugins; the two are kept in step.
const PORTOLAN_VERSION = "0.1.0";
const SELF = fileURLToPath(import.meta.url);

// A flow's view id, as gen-likec4.mjs and src/likec4/ids.ts spell it.
const RESERVED = new Set(reserved);
const safeId = (raw) => {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) || RESERVED.has(cleaned) ? `_${cleaned}` : cleaned;
};
const flowViewId = (slug) => `flow_${safeId(slug)}`;

// ---------------------------------------------------------------------------
// Names

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * The file a draft is saved in. A branch name keeps its slashes as
 * directories would be one level too clever: `demo/x` and a project called
 * `demo` would share a folder, so a slash is spelled `~`, which git refuses in
 * a branch name and therefore never collides.
 */
export function draftPath(project, branch) {
  if (!PROJECT_ID.test(project)) throw new Error(`not a project id: ${JSON.stringify(project)}`);
  if (!validBranch(branch)) throw new Error(`not a branch name: ${JSON.stringify(branch)}`);
  return join(DRAFTS_DIR, project, `${branch.replaceAll("/", "~")}.json`);
}

/** What `git check-ref-format --branch` accepts, checked without a process. */
export function validBranch(branch) {
  return typeof branch === "string"
    && branch.length > 0
    && branch.length <= 200
    && !branch.startsWith("-")
    && !branch.startsWith("/")
    && !branch.endsWith("/")
    && !branch.endsWith(".")
    && !branch.endsWith(".lock")
    && !branch.includes("..")
    && !branch.includes("//")
    && !branch.includes("@{")
    && !/[\x00-\x20~^:?*[\\\x7f]/.test(branch);
}

// ---------------------------------------------------------------------------
// Git

function git(workspace, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (cause) {
    if (allowFailure) return null;
    const stderr = cause?.stderr ? String(cause.stderr).trim() : "";
    throw new Error(`git ${args.join(" ")}: ${stderr || (cause instanceof Error ? cause.message : String(cause))}`);
  }
}

function commitOf(workspace, ref) {
  return git(workspace, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFailure: true }) || null;
}

/**
 * The main a draft is compared from. The remote's is preferred: a local main
 * that has not been pulled would put main's own progress into every branch.
 */
export function mainRef(workspace) {
  for (const ref of ["origin/main", "main", "origin/master", "master"]) {
    if (commitOf(workspace, ref)) return ref;
  }
  throw new Error("no main branch: neither origin/main nor main resolves");
}

/** A branch's tip, local first, then as the remote has it. */
export function tipOf(workspace, branch) {
  return commitOf(workspace, `refs/heads/${branch}`) ?? commitOf(workspace, `refs/remotes/origin/${branch}`);
}

/** Which manifest projects a set of changed paths falls in, most specific root first. */
export function projectsTouched(projects, paths) {
  const roots = [...projects]
    .filter((project) => typeof project?.id === "string" && typeof project?.root === "string")
    .sort((left, right) => right.root.length - left.root.length);
  const touched = new Set();
  for (const path of paths) {
    const owner = roots.find((project) => project.root === "." || path === project.root || path.startsWith(`${project.root}/`));
    if (owner) touched.add(owner.id);
  }
  return [...touched].sort();
}

/**
 * Every branch with commits main does not have, with the projects those
 * commits touch. A branch main already contains has nothing to draft.
 */
export function listBranches(workspace, projects) {
  const main = mainRef(workspace);
  const names = new Set();
  for (const line of git(workspace, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"]).split("\n")) {
    const name = line.startsWith("refs/heads/") ? line.slice("refs/heads/".length) : line.startsWith("refs/remotes/origin/") ? line.slice("refs/remotes/origin/".length) : "";
    if (name && name !== "HEAD" && name !== "main" && name !== "master") names.add(name);
  }
  const branches = [];
  for (const branch of [...names].sort()) {
    const tip = tipOf(workspace, branch);
    if (!tip) continue;
    const base = git(workspace, ["merge-base", main, tip], { allowFailure: true });
    if (!base || base === tip) continue;
    const changed = git(workspace, ["diff", "--name-only", base, tip]).split("\n").filter(Boolean);
    const ahead = Number(git(workspace, ["rev-list", "--count", `${base}..${tip}`]));
    branches.push({ branch, tip, base, ahead, projects: projectsTouched(projects, changed) });
  }
  return {
    main,
    projects: projects.filter((project) => typeof project?.id === "string").map((project) => ({ id: project.id, name: project.name ?? project.id })),
    branches,
  };
}

// ---------------------------------------------------------------------------
// One project's catalog at one commit

/**
 * The steps of one phase that read the project, by the most specific root
 * that holds their input.
 */
export function projectSteps(manifest, projectId, phase = "extract") {
  return (manifest[phase] ?? []).filter((step) => projectsTouched(manifest.projects ?? [], [String(step.in ?? "").replace(/\\/g, "/").replace(/\/+$/, "") || "."])[0] === projectId);
}

/**
 * Runs inside a worktree (the `catalog` command): the project's extract steps
 * over the checkout, then the whole catalog read the way gen reads it. The
 * other projects keep the fragments committed at this commit, which is the
 * same on both sides of a draft unless the branch changed them too.
 */
async function catalogHere(projectId, out) {
  const [{ loadManifest, stepKeys }, { describePlugin, runPlugin }, { builtinPlugin }, { historyFor }, { writeOutputFile }, { loadCatalog }] = await Promise.all([
    import("./manifest.mjs"),
    import("./plugin-host.mjs"),
    import("./builtin-plugins.mjs"),
    import("./history.mjs"),
    import("./output-path.mjs"),
    import("./catalog-sources.mjs"),
  ]);
  const loaded = loadManifest("portolan.json");
  if (loaded.problems.length > 0) throw new Error(`portolan.json at this commit does not match the schema:\n  ${loaded.problems.join("\n  ")}`);
  const manifest = loaded.manifest;
  if (!(manifest.projects ?? []).some((project) => project.id === projectId)) {
    throw new Error(`the manifest at this commit has no project ${JSON.stringify(projectId)}`);
  }
  // The extractors of the checkout generating the draft (portolan.0019), not
  // the commit's: a worktree has no plugin builds. A plugin the manifest
  // declares by a relative file is found in that checkout too.
  const host = process.env.PORTOLAN_DRAFT_HOST ?? process.cwd();
  const pluginNamed = (name) => {
    const shipped = builtinPlugin(name);
    if (shipped) return shipped;
    const declared = (manifest.plugins ?? []).find((plugin) => plugin.name === name);
    const url = declared?.wasm?.url;
    if (url?.startsWith("file://") && !url.startsWith("file:///")) {
      return { ...declared, wasm: { ...declared.wasm, url: `file://${resolve(host, url.slice("file://".length))}` } };
    }
    return declared;
  };

  const keys = stepKeys(manifest);
  // What the step wrote at this commit, from the listing gen keeps beside its
  // output. A file the step no longer writes is removed, as gen's sweep would.
  const committed = (step) => {
    try { return JSON.parse(readFileSync(join(step.out, ".portolan-manifest"), "utf8"))[keys.keyOf(step)] ?? []; }
    catch { return []; }
  };
  const warnings = [];
  const run = async (phase, step, request) => {
    const plugin = pluginNamed(step.plugin);
    if (!plugin) throw new Error(`no plugin ${JSON.stringify(step.plugin)}`);
    progress(`${phase} ${step.plugin} ← ${step.in}`);
    const response = await runPlugin(plugin, { portolanVersion: PORTOLAN_VERSION, ...request, options: step.options ?? {} }, {}, { workspace: process.cwd() });
    const written = new Set();
    for (const file of response.files) {
      writeOutputFile(step.out, file.name, file.encoding === "base64" ? Buffer.from(file.contents, "base64") : file.contents);
      written.add(file.name);
    }
    for (const name of committed(step)) {
      if (!written.has(name)) rmSync(join(step.out, name), { force: true });
    }
    warnings.push(...(response.warnings ?? []).map((warning) => `${step.plugin}: ${typeof warning === "string" ? warning : warning.message ?? JSON.stringify(warning)}`));
  };

  for (const step of projectSteps(manifest, projectId, "extract")) {
    const plugin = pluginNamed(step.plugin);
    const needsHistory = plugin && ((await describePlugin(plugin).catch(() => null))?.needs ?? []).includes("history");
    const history = needsHistory ? historyFor(process.cwd(), step.in) : undefined;
    await run("extract", step, { input: { root: step.in, output: step.out, ...(history ? { history } : {}) } });
  }

  // Verifiers read what was observed against the catalog the extractors just
  // wrote, without their own last output - or a flow the branch removed would
  // be carried on by the trace that once saw it.
  for (const step of projectSteps(manifest, projectId, "verify")) {
    const own = committed(step).map((name) => join(step.out, name));
    const { catalog } = await loadCatalog("portolan.json", { exclude: own });
    await run("verify", step, { input: { root: step.in, output: step.out }, catalog });
  }

  progress("merge the catalog");
  const { catalog } = await loadCatalog("portolan.json");
  writeFileSync(out, JSON.stringify({ catalog, manifest, warnings }));
}

let lastProgress = "";

function progress(message) {
  lastProgress = message;
  process.stdout.write(`${EVENT_PREFIX}${JSON.stringify({ type: "draft-progress", message })}\n`);
}

/** Checks the commit out beside the repository and reads the project's catalog there. */
async function catalogAt(workspace, commit, projectId, holder, label) {
  const tree = join(holder, label);
  const out = join(holder, `${label}.json`);
  git(workspace, ["worktree", "add", "--detach", "--force", tree, commit]);
  try {
    await new Promise((done, fail) => {
      const child = spawn(process.execPath, [SELF, "catalog", "--project", projectId, "--out", out], {
        cwd: tree,
        env: { ...process.env, PORTOLAN_DRAFT_HOST: workspace },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stdout.on("data", (chunk) => process.stdout.write(String(chunk).replaceAll(`"message":"`, `"message":"${label}: `)));
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", fail);
      child.on("close", (code) => code === 0 ? done() : fail(new Error(`${label} (${commit.slice(0, 12)}): ${stderr.trim().split("\n").slice(-12).join("\n") || `exited with ${code}`}`)));
    });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    git(workspace, ["worktree", "remove", "--force", tree], { allowFailure: true });
  }
}

// ---------------------------------------------------------------------------
// Views

/**
 * The laid-out LikeC4 views of the flows the draft touched, drawn from the
 * catalog that has them: the branch's for a flow added or changed, the base's
 * for one removed. Laid out here rather than in the browser, so the site
 * renders a draft's flow the way it renders main's.
 */
export async function draftViews(entities, sides) {
  const { likec4Sources } = await import("./gen-likec4.mjs");
  const { LikeC4 } = await import("likec4");
  const views = {};
  // The model elements those views draw, ancestors included: a lane the
  // branch adds is an element main's model does not have.
  const elements = {};
  for (const [side, { catalog, manifest }] of Object.entries(sides)) {
    const flows = entities.filter((entity) => entity.kind === "flow" && (side === "branch" ? entity.change !== "removed" : entity.change === "removed"));
    if (flows.length === 0) continue;
    progress(`lay out ${flows.length} flow view${flows.length === 1 ? "" : "s"} on the ${side}`);
    const files = await likec4Sources({ catalog, manifest });
    const holder = mkdtempSync(join(tmpdir(), "portolan-draft-c4-"));
    try {
      for (const file of files) {
        mkdirSync(dirname(join(holder, file.name)), { recursive: true });
        writeFileSync(join(holder, file.name), file.contents);
      }
      const likec4 = await LikeC4.fromWorkspace(holder, { printErrors: false, logger: false });
      try {
        const model = await likec4.layoutedModel();
        const laidOut = model.$data.views;
        for (const flow of flows) {
          const slug = (side === "branch" ? flow.branch : flow.base)?.slug;
          if (!slug) continue;
          for (const id of Object.keys(laidOut)) {
            if (id !== flowViewId(slug) && id !== `${flowViewId(slug)}_cross`) continue;
            views[id] = laidOut[id];
            for (const node of laidOut[id].nodes ?? []) {
              const parts = String(node.modelRef ?? node.id).split(".");
              for (let at = 1; at <= parts.length; at++) {
                const fqn = parts.slice(0, at).join(".");
                if (model.$data.elements[fqn]) elements[fqn] = model.$data.elements[fqn];
              }
            }
          }
        }
      } finally {
        await likec4.dispose();
      }
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  }
  return { views, elements };
}

// ---------------------------------------------------------------------------
// Drafts

/**
 * Where a generated draft waits for the reader to save or discard it. A
 * regeneration that is not kept must leave the saved draft as it was, so it is
 * written here rather than over it.
 */
export function pendingPath(project, branch) {
  return join(".portolan", "branch-drafts", "pending", relative(DRAFTS_DIR, draftPath(project, branch)));
}

/** Where a deleted draft is kept until the next deletion of it, for an undo. */
function trashPath(project, branch) {
  return join(".portolan", "branch-drafts", "trash", relative(DRAFTS_DIR, draftPath(project, branch)));
}

export async function generateDraft(workspace, { project, branch, pending = false }) {
  // Imported here, not at the top: local-api.mjs loads this file from the
  // published package too, where Node strips no TypeScript, and listing or
  // deleting a draft needs none.
  const { DRAFT_SCHEMA, diffBranch } = await import("../src/lib/branch-draft.ts");
  const target = pending ? pendingPath(project, branch) : draftPath(project, branch);
  const main = mainRef(workspace);
  const tip = tipOf(workspace, branch);
  const failed = (message) => {
    recordFailure(workspace, project, branch, message);
    return new Error(message);
  };
  if (!tip) throw failed(`no branch ${JSON.stringify(branch)}, locally or on origin`);
  const base = git(workspace, ["merge-base", main, tip], { allowFailure: true });
  if (!base) throw failed(`${branch} shares no history with ${main}`);
  if (base === tip) throw failed(`${main} already contains ${branch}; there is nothing to draft`);

  progress(`merge-base ${main} ${branch}: ${base.slice(0, 12)}, tip ${tip.slice(0, 12)}`);
  const holder = mkdtempSync(join(tmpdir(), "portolan-draft-"));
  // A cancelled run is a signal, and a signal skips `finally`: the worktrees
  // would stay registered in the repository until somebody prunes them.
  const cancelled = () => {
    rmSync(holder, { recursive: true, force: true });
    git(workspace, ["worktree", "prune"], { allowFailure: true });
    process.exit(143);
  };
  process.once("SIGTERM", cancelled);
  process.once("SIGINT", cancelled);
  try {
    const before = await catalogAt(workspace, base, project, holder, "base");
    const after = await catalogAt(workspace, tip, project, holder, "branch");
    progress("compare the catalogs");
    const entities = diffBranch(before.catalog, after.catalog);
    const { views, elements } = await draftViews(entities, { branch: after, base: before });
    const draft = {
      schema: DRAFT_SCHEMA,
      project,
      branch,
      tip,
      base,
      generatedAt: new Date().toISOString(),
      entities,
      ...(Object.keys(views).length > 0 ? { views, elements } : {}),
    };
    const file = join(workspace, target);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
    if (!pending) forgetFailure(workspace, project, branch);
    return { path: target, entities: entities.length, views: Object.keys(views).length, warnings: after.warnings };
  } catch (cause) {
    recordFailure(workspace, project, branch, cause instanceof Error ? cause.message : String(cause));
    throw cause;
  } finally {
    process.off("SIGTERM", cancelled);
    process.off("SIGINT", cancelled);
    rmSync(holder, { recursive: true, force: true });
    git(workspace, ["worktree", "prune"], { allowFailure: true });
  }
}

/**
 * Every saved draft, with what `portolan dev` can say about it now: the
 * branch moved past the saved tip, is gone, or its last regeneration failed.
 */
export function listDrafts(workspace) {
  const root = join(workspace, DRAFTS_DIR);
  const failures = readFailures(workspace);
  const drafts = [];
  if (existsSync(root)) {
    for (const project of readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      for (const entry of readdirSync(join(root, project.name), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(DRAFTS_DIR, project.name, entry.name);
        let draft;
        try { draft = JSON.parse(readFileSync(join(workspace, path), "utf8")); }
        catch { drafts.push({ path, project: project.name, status: "unreadable" }); continue; }
        const tip = tipOf(workspace, draft.branch);
        const failure = failures[`${draft.project}\n${draft.branch}`];
        const ahead = tip && tip !== draft.tip ? Number(git(workspace, ["rev-list", "--count", `${draft.tip}..${tip}`], { allowFailure: true }) ?? 0) : 0;
        drafts.push({
          path,
          project: draft.project,
          branch: draft.branch,
          tip: draft.tip,
          base: draft.base,
          generatedAt: draft.generatedAt,
          entities: draft.entities?.length ?? 0,
          status: failure ? "failed" : !tip ? "gone" : tip !== draft.tip ? "moved" : "fresh",
          ...(tip && tip !== draft.tip ? { currentTip: tip, ahead } : {}),
          ...(failure ? { failure } : {}),
        });
      }
    }
  }
  return drafts.sort((left, right) => `${left.project}/${left.branch}`.localeCompare(`${right.project}/${right.branch}`));
}

/** Every saved draft file, as written. */
export function readDrafts(workspace) {
  const root = join(workspace, DRAFTS_DIR);
  const drafts = [];
  if (!existsSync(root)) return drafts;
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    for (const entry of readdirSync(join(root, project.name), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try { drafts.push(JSON.parse(readFileSync(join(root, project.name, entry.name), "utf8"))); }
      catch { /* listed as unreadable by listDrafts */ }
    }
  }
  return drafts.sort((left, right) => `${left.project}/${left.branch}`.localeCompare(`${right.project}/${right.branch}`));
}

/** A generated draft that has not been saved or discarded yet, or null. */
export function readPending(workspace, { project, branch }) {
  try { return JSON.parse(readFileSync(join(workspace, pendingPath(project, branch)), "utf8")); }
  catch { return null; }
}

function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(from));
  rmSync(from);
  const folder = dirname(from);
  if (readdirSync(folder).length === 0) rmSync(folder, { recursive: true });
}

/** Keeps a pending draft: it replaces the saved one, if there was one. */
export function saveDraft(workspace, { project, branch }) {
  const from = join(workspace, pendingPath(project, branch));
  if (!existsSync(from)) throw Object.assign(new Error(`no generated draft of ${branch} waits to be saved`), { status: 404 });
  move(from, join(workspace, draftPath(project, branch)));
  forgetFailure(workspace, project, branch);
  return draftPath(project, branch);
}

export function discardDraft(workspace, { project, branch }) {
  const file = join(workspace, pendingPath(project, branch));
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/** Deletes a saved draft, keeping it aside so the deletion can be undone. */
export function deleteDraft(workspace, { project, branch }) {
  const file = join(workspace, draftPath(project, branch));
  if (!existsSync(file)) return false;
  move(file, join(workspace, trashPath(project, branch)));
  forgetFailure(workspace, project, branch);
  return true;
}

export function restoreDraft(workspace, { project, branch }) {
  const from = join(workspace, trashPath(project, branch));
  if (!existsSync(from)) throw Object.assign(new Error(`no deleted draft of ${branch} to restore`), { status: 404 });
  move(from, join(workspace, draftPath(project, branch)));
  return draftPath(project, branch);
}

// A failed regeneration is not a draft and never reaches the repository; it
// is remembered beside the build report, for the branches page to show.
const FAILURES = join(".portolan", "branch-drafts.json");

function readFailures(workspace) {
  try { return JSON.parse(readFileSync(join(workspace, FAILURES), "utf8")); }
  catch { return {}; }
}

function writeFailures(workspace, failures) {
  mkdirSync(join(workspace, ".portolan"), { recursive: true });
  writeFileSync(join(workspace, FAILURES), `${JSON.stringify(failures, null, 2)}\n`);
}

function recordFailure(workspace, project, branch, message) {
  writeFailures(workspace, { ...readFailures(workspace), [`${project}\n${branch}`]: { message, at: new Date().toISOString(), step: lastProgress } });
}

function forgetFailure(workspace, project, branch) {
  const failures = readFailures(workspace);
  if (!(`${project}\n${branch}` in failures)) return;
  delete failures[`${project}\n${branch}`];
  writeFailures(workspace, failures);
}

// ---------------------------------------------------------------------------
// The site

const DRAFTS_MODULE = "virtual:portolan-drafts";
const resolvedDraftsModule = `\0${DRAFTS_MODULE}`;

/**
 * The saved drafts as one module, in dev and in the static build alike. The
 * dev server re-reads them on every page load; a page that changed them in
 * place asks the local API instead.
 */
export function draftsPlugin(workspace) {
  return {
    name: "portolan-drafts",
    resolveId(id) { return id === DRAFTS_MODULE ? resolvedDraftsModule : undefined; },
    load(id) {
      if (id !== resolvedDraftsModule) return;
      return `export default ${JSON.stringify(readDrafts(workspace))};`;
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.headers.accept?.includes("text/html")) {
          const mod = server.moduleGraph.getModuleById(resolvedDraftsModule);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        next();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Command line

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args) {
  const [command] = args;
  const workspace = process.cwd();
  if (command === "catalog") {
    await catalogHere(option(args, "project"), resolve(option(args, "out")));
    return;
  }
  const project = option(args, "project");
  const branch = option(args, "branch");
  if (command === "branches") {
    const { readManifest } = await import("./manifest.mjs");
    console.log(JSON.stringify(listBranches(workspace, readManifest("portolan.json").projects ?? []), null, 2));
  } else if (command === "list") {
    console.log(JSON.stringify(listDrafts(workspace), null, 2));
  } else if (command === "generate") {
    const result = await generateDraft(workspace, { project, branch, pending: args.includes("--pending") });
    for (const warning of result.warnings) console.warn(`  warning  ${warning}`);
    process.stdout.write(`${EVENT_PREFIX}${JSON.stringify({ type: "draft-ready", project, branch, ...result })}\n`);
    console.log(`${result.path}: ${result.entities} entit${result.entities === 1 ? "y" : "ies"}, ${result.views} view${result.views === 1 ? "" : "s"}`);
  } else if (command === "delete") {
    console.log(deleteDraft(workspace, { project, branch }) ? `deleted ${draftPath(project, branch)}` : `no draft ${draftPath(project, branch)}`);
  } else {
    throw new Error("usage: branch-drafts.mjs branches | list | generate --project <id> --branch <name> | delete --project <id> --branch <name>");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(`branch-drafts: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
