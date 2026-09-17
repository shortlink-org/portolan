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
// A project whose source is vendored from another repository is drafted from
// a clone of that repository instead (portolan.0029): the worktrees are of the
// workspace as it is, and what differs between the two sides is the snapshot
// of the service, put there at the branch's tip and at its merge-base.
//
//   node scripts/branch-drafts.mjs branches
//   node scripts/branch-drafts.mjs list
//   node scripts/branch-drafts.mjs generate --project auth --branch demo/auth-passkeys
//   node scripts/branch-drafts.mjs delete --project auth --branch demo/auth-passkeys

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { builtinDefinition } from "./builtin-plugins.mjs";
import { readManifest } from "./manifest.mjs";
import { copyPath, splitRepo } from "./host-plugins/fetch-git.mjs";
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

// ---------------------------------------------------------------------------
// A project that lives in another repository
//
// An estate whose services are vendored has no branches of its own: the
// workspace holds a snapshot of every service, fetched by `fetch-git`, and a
// feature branch is a branch of the service's repository. Such a project says
// where a clone of that repository is, and a draft of its branch is generated
// by putting the clone's tree where the snapshot sits - at the branch's tip on
// one side, at its merge-base on the other. Everything after that is the
// comparison any other draft makes (portolan.0029).

/** The clone a project names, absolute, or "" for a project of this repository. */
export function cloneOf(workspace, project) {
  const clone = typeof project?.clone === "string" ? project.clone.trim() : "";
  return clone ? resolve(workspace, clone) : "";
}

const rootPath = (root) => String(root ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");

/** Whether a step is the one that fetches other repositories into the workspace. */
function fetches(manifest, step) {
  const declared = (manifest.plugins ?? []).find((plugin) => plugin.name === step.plugin);
  return ((declared ?? builtinDefinition(step.plugin))?.host ?? "") === "fetch-git";
}

/**
 * The fetch step and the repository entry whose copy is a project's root, or
 * null for a project whose source this repository holds itself.
 */
export function vendorOf(manifest, project) {
  for (const step of manifest.extract ?? []) {
    if (!step?.options?.cache || !fetches(manifest, step)) continue;
    for (const want of step.options.repos ?? []) {
      if (copyPath(step.options.cache, splitRepo(want.repo).dir) === rootPath(project?.root)) return { step, want };
    }
  }
  return null;
}

/** Whether a path of the service's repository is one the snapshot takes. */
function taken(path, want) {
  const paths = (Array.isArray(want?.paths) ? want.paths : []).map((prefix) => rootPath(prefix)).filter(Boolean);
  return paths.length === 0 || paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * What the branch changed in the project's own files, from its base: how many
 * and the directories they are in. A branch that changes nothing the catalog
 * models still changed something, and the page says what rather than leaving
 * the reader with "no changes".
 */
export function touchedBy(source, base, tip, scope) {
  const changed = git(source, ["diff", "--name-only", base, tip], { allowFailure: true });
  const paths = (changed ?? "").split("\n").filter(Boolean).filter((path) => scope.want
    ? taken(path, scope.want)
    : projectsTouched(scope.projects, [path])[0] === scope.project?.id);
  const root = scope.want ? "" : rootPath(scope.project?.root);
  const dirs = new Map();
  for (const path of paths) {
    const inside = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    const at = inside.indexOf("/");
    const dir = at > 0 ? `${inside.slice(0, at)}/` : inside;
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  // Where the change is, not what sorts first: a branch that touches ten files
  // in internal/ and one .gitlab-ci.yml is about internal/.
  const ranked = [...dirs].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return { files: paths.length, dirs: ranked.slice(0, 6).map(([dir]) => dir) };
}

/**
 * When a clone last fetched, as its FETCH_HEAD was written. Dev never fetches
 * by itself, so a draft is only as current as this: a branch that moved on the
 * forge and not here is drafted at the commit the clone has.
 */
export function fetchedAt(repo) {
  for (const name of ["FETCH_HEAD", "HEAD"]) {
    try { return statSync(join(repo, ".git", name)).mtime.toISOString(); }
    catch { /* a clone that never fetched, or a worktree; try the next */ }
  }
  return null;
}

/** Fetches a project's clone, so dev can see where its branches are now. */
export function fetchClone(workspace, { project }) {
  const declared = (manifestOf(workspace).projects ?? []).find((entry) => entry.id === project);
  const clone = declared ? cloneOf(workspace, declared) : "";
  if (!clone) throw Object.assign(new Error(`${project} is not drafted from a clone`), { status: 400 });
  if (!existsSync(join(clone, ".git"))) throw Object.assign(new Error(`no clone of ${project} at ${declared.clone}`), { status: 404 });
  git(clone, ["fetch", "--prune", "--quiet", "origin"]);
  return { project, clone: declared.clone, fetchedAt: fetchedAt(clone) };
}

/**
 * The manifest, or nothing at all: a draft is asked for in a workspace that
 * has one, and a test repository with two files is still a repository whose
 * branches can be listed.
 */
function manifestOf(workspace) {
  try { return readManifest(join(workspace, "portolan.json")); }
  catch { return {}; }
}

/** The projects of a manifest that are drafted from a clone, with what that needs. */
function clonedProjects(workspace, manifest) {
  const out = [];
  for (const project of manifest.projects ?? []) {
    if (typeof project?.id !== "string") continue;
    const clone = cloneOf(workspace, project);
    if (!clone) continue;
    out.push({ project, clone, vendor: vendorOf(manifest, project) });
  }
  return out;
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
 * Every branch of one repository with commits its main does not have, each
 * with the projects the changed paths belong to. A branch main already
 * contains has nothing to draft.
 */
function branchesIn(repo, owner) {
  const main = mainRef(repo);
  const names = new Set();
  for (const line of git(repo, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"]).split("\n")) {
    const name = line.startsWith("refs/heads/") ? line.slice("refs/heads/".length) : line.startsWith("refs/remotes/origin/") ? line.slice("refs/remotes/origin/".length) : "";
    if (name && name !== "HEAD" && name !== "main" && name !== "master") names.add(name);
  }
  const branches = [];
  for (const branch of [...names].sort()) {
    const tip = tipOf(repo, branch);
    if (!tip) continue;
    const base = git(repo, ["merge-base", main, tip], { allowFailure: true });
    if (!base || base === tip) continue;
    const changed = git(repo, ["diff", "--name-only", base, tip]).split("\n").filter(Boolean);
    const ahead = Number(git(repo, ["rev-list", "--count", `${base}..${tip}`]));
    branches.push({ branch, tip, base, ahead, main, projects: owner(changed) });
  }
  return { main, branches };
}

/**
 * Every branch that could be drafted: the workspace's own, for the projects
 * this repository holds, and each cloned project's, read from its clone. Two
 * projects may be on a branch of the same name; each is an entry of its own,
 * because they are branches of two repositories and share nothing but a name.
 *
 * A clone that is not on this machine is reported rather than thrown: the
 * other projects can still be drafted, and the page says what is missing.
 */
export function listBranches(workspace, manifest) {
  const projects = (manifest?.projects ?? []).filter((project) => typeof project?.id === "string");
  const own = projects.filter((project) => !cloneOf(workspace, project));
  const { main, branches } = branchesIn(workspace, (changed) => projectsTouched(own, changed));
  const problems = [];
  for (const { project, clone, vendor } of clonedProjects(workspace, manifest ?? {})) {
    if (!existsSync(join(clone, ".git"))) {
      problems.push(`${project.id}: no clone at ${project.clone}`);
      continue;
    }
    if (!vendor) {
      problems.push(`${project.id}: no fetch step puts a repository at ${project.root}`);
      continue;
    }
    try {
      const found = branchesIn(clone, (changed) => changed.some((path) => taken(path, vendor.want)) ? [project.id] : []);
      branches.push(...found.branches);
    } catch (cause) {
      problems.push(`${project.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return {
    main,
    projects: projects.map((project) => ({ id: project.id, name: project.name ?? project.id })),
    branches,
    ...(problems.length > 0 ? { problems } : {}),
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
async function catalogHere(projectId, out, vendor = null) {
  const [{ loadManifest, stepKeys }, { describePlugin, runPlugin }, { builtinPlugin }, { historyFor }, { writeOutputFile }, { loadCatalog }, { repositoryInput }] = await Promise.all([
    import("./manifest.mjs"),
    import("./plugin-host.mjs"),
    import("./builtin-plugins.mjs"),
    import("./history.mjs"),
    import("./output-path.mjs"),
    import("./catalog-sources.mjs"),
    import("./host-plugins/fetch-git.mjs"),
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

  // The service's own tree, put where the snapshot sits, before anything
  // reads it: this is the side of the draft this run is. It is read out of the
  // clone rather than fetched, so a branch that was never pushed - or one
  // pushed to a remote the manifest does not name - is drafted all the same.
  if (vendor) {
    const step = (manifest.extract ?? []).find((candidate) => fetches(manifest, candidate) && (candidate.options?.repos ?? []).some((want) => want.repo === vendor.repo));
    if (!step) throw new Error(`the manifest at this commit fetches no repository ${JSON.stringify(vendor.repo)}`);
    const want = step.options.repos.find((entry) => entry.repo === vendor.repo);
    const dir = splitRepo(vendor.repo).dir;
    progress(`${vendor.repo} at ${vendor.commit.slice(0, 12)}`);
    const { run: fetchGit } = await import("./host-plugins/fetch-git.mjs");
    const { files } = fetchGit(
      { portolanVersion: PORTOLAN_VERSION, input: { root: step.in, output: step.out }, options: { cache: step.options.cache, repos: [{ ...want, commit: vendor.commit }] } },
      { env: process.env, from: (repo) => (repo === vendor.repo ? vendor.from : undefined) },
    );
    const written = new Set();
    for (const file of files) {
      writeOutputFile(step.out, file.name, file.contents);
      written.add(file.name);
    }
    // A file this commit does not have goes, or the side would hold both the
    // snapshot committed here and the file the branch deleted.
    for (const name of committed(step)) {
      if (name.startsWith(`${dir}/`) && !written.has(name)) rmSync(join(step.out, name), { force: true });
    }
  }

  for (const step of projectSteps(manifest, projectId, "extract")) {
    const plugin = pluginNamed(step.plugin);
    const needsHistory = plugin && ((await describePlugin(plugin).catch(() => null))?.needs ?? []).includes("history");
    const history = needsHistory ? historyFor(process.cwd(), step.in) : undefined;
    // The same repository gen hands over, so a draft spells paths as main does.
    await run("extract", step, { input: { root: step.in, output: step.out, ...repositoryInput(process.cwd(), step.in), ...(history ? { history } : {}) } });
  }

  // Verifiers read what was observed against the catalog the extractors just
  // wrote, without their own last output - or a flow the branch removed would
  // be carried on by the trace that once saw it.
  for (const step of projectSteps(manifest, projectId, "verify")) {
    const own = committed(step).map((name) => join(step.out, name));
    const { catalog } = await loadCatalog("portolan.json", { exclude: own });
    await run("verify", step, { input: { root: step.in, output: step.out, ...repositoryInput(process.cwd(), step.in) }, catalog });
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

/**
 * Checks the commit out beside the repository and reads the project's catalog
 * there. `vendor` is the service's tree to put in the checkout first, for a
 * project whose source comes from another repository.
 */
async function catalogAt(workspace, commit, projectId, holder, label, vendor = null) {
  const tree = join(holder, label);
  const out = join(holder, `${label}.json`);
  git(workspace, ["worktree", "add", "--detach", "--force", tree, commit]);
  try {
    await new Promise((done, fail) => {
      const args = vendor ? ["--vendor-repo", vendor.repo, "--vendor-commit", vendor.commit, "--vendor-from", vendor.from] : [];
      const child = spawn(process.execPath, [SELF, "catalog", "--project", projectId, "--out", out, ...args], {
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
  // By URL, not by specifier: Vite bundles its config, this module with it,
  // and a specifier it can follow pulls gen-likec4.mjs and its top-level
  // await into a bundle that cannot hold one - `portolan build` then fails
  // to load the config. The file is read where it lies, only when drawn.
  const { likec4Sources } = await import(/* @vite-ignore */ new URL("./gen-likec4.mjs", import.meta.url).href);
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
  const failed = (message) => {
    recordFailure(workspace, project, branch, message);
    return new Error(message);
  };
  // Where the branch is, and what is put in the checkout to read it. For a
  // project of this repository both sides are two commits of the workspace;
  // for a vendored one the workspace stays where it is and the snapshot of
  // the service moves (portolan.0029).
  const manifest = manifestOf(workspace);
  const declared = (manifest.projects ?? []).find((entry) => entry.id === project) ?? null;
  const clone = declared ? cloneOf(workspace, declared) : "";
  const vendored = clone ? vendorOf(manifest, declared) : null;
  if (clone && !existsSync(join(clone, ".git"))) throw failed(`${project} is drafted from ${declared.clone}, and there is no clone of it there`);
  if (clone && !vendored) throw failed(`${project} is drafted from ${declared.clone}, but no fetch step puts a repository at ${declared.root}`);
  const source = clone || workspace;
  const main = mainRef(source);
  const tip = tipOf(source, branch);
  if (!tip) throw failed(`no branch ${JSON.stringify(branch)}, locally or on origin`);
  const base = git(source, ["merge-base", main, tip], { allowFailure: true });
  if (!base) throw failed(`${branch} shares no history with ${main}`);
  if (base === tip) throw failed(`${main} already contains ${branch}; there is nothing to draft`);
  const here = clone ? commitOf(workspace, "HEAD") : null;
  if (clone && !here) throw failed("this repository has no commit yet, so there is no catalog to lay the branch over");
  const side = (commit) => (clone ? { repo: vendored.want.repo, commit, from: clone } : null);
  const touched = touchedBy(source, base, tip, clone ? { want: vendored.want } : { project: declared, projects: manifest.projects ?? [] });

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
    const before = await catalogAt(workspace, here ?? base, project, holder, "base", side(base));
    const after = await catalogAt(workspace, here ?? tip, project, holder, "branch", side(tip));
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
      ...(touched.files > 0 ? { touched } : {}),
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

/** Where each project's branches are: its clone, or this repository. */
function draftSources(workspace) {
  const found = new Map();
  for (const { project, clone } of clonedProjects(workspace, manifestOf(workspace))) found.set(project.id, clone);
  return found;
}

/**
 * Every saved draft, with what `portolan dev` can say about it now: the
 * branch moved past the saved tip, is gone, or its last regeneration failed.
 */
export function listDrafts(workspace) {
  const root = join(workspace, DRAFTS_DIR);
  const failures = readFailures(workspace);
  const clones = draftSources(workspace);
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
        // A vendored project's branch is in its clone, not here.
        const source = clones.get(draft.project) ?? workspace;
        const missing = source !== workspace && !existsSync(join(source, ".git"));
        const tip = missing ? null : tipOf(source, draft.branch);
        const failure = failures[`${draft.project}\n${draft.branch}`]
          ?? (missing ? { message: `no clone of ${draft.project} at ${relative(workspace, source)}`, at: new Date().toISOString() } : undefined);
        const ahead = tip && tip !== draft.tip ? Number(git(source, ["rev-list", "--count", `${draft.tip}..${tip}`], { allowFailure: true }) ?? 0) : 0;
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
          ...(source !== workspace && !missing ? { clone: relative(workspace, source), fetchedAt: fetchedAt(source) ?? undefined } : {}),
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
    const repo = option(args, "vendor-repo");
    await catalogHere(option(args, "project"), resolve(option(args, "out")), repo ? { repo, commit: option(args, "vendor-commit"), from: option(args, "vendor-from") } : null);
    return;
  }
  const project = option(args, "project");
  const branch = option(args, "branch");
  if (command === "branches") {
    console.log(JSON.stringify(listBranches(workspace, manifestOf(workspace)), null, 2));
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
