import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import options from "./work-items.options.json" with { type: "json" };
import { detectTaskKeys, normalizeTrackers, taskUrl } from "../../src/lib/task-tracker-config.mjs";
import { bare, pinFor } from "../../src/lib/repo-name.mjs";

export function describe() {
  return { name: "work-items", summary: "Connects YouTrack, Jira, Linear, GitHub and GitLab issue references in Git commits to flows, steps, services and decisions, retaining the source of each association. The links are read from the history where the catalog is read, never written into a fragment (portolan.0020).", category: "evidence", phases: ["verify"], options };
}

function webRepository(value) {
  const normalized = value.trim().replace(/^git@([^:]+):/, "https://$1/").replace(/^ssh:\/\/git@/, "https://").replace(/\.git\/?$/, "").replace(/\/$/, "");
  const url = new URL(normalized);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("work-items: repository must be an HTTP(S) web URL without credentials, query or fragment");
  return normalized;
}

function sourcePath(value) {
  if (!value) return null;
  const path = value.replace(/:\d+(?::\d+)?$/, "").replace(/^\.\//, "");
  return path && !path.startsWith("/") && !path.includes(":") && !path.split("/").includes("..") ? path : null;
}

function steps(nodes) {
  return nodes.flatMap((node) => node.type === "step" ? [node]
    : node.type === "parallel" ? node.branches.flatMap(steps)
    : node.type === "alt" ? node.branches.flatMap((branch) => steps(branch.steps))
    : node.type === "loop" ? steps(node.steps) : []);
}

/**
 * A path as the repository spells it. Extractors spell a fetched service's
 * files from its own repository now (`input.repository`); a catalog written
 * before that spells them from the workspace, under the copy's directory - the
 * pin's `path`, or fetch-git's usual `vendor/repos/<owner>/<name>/` - and this
 * reads those back the way source links do (src/lib/source-link.ts). A path
 * already spelled from the repository passes through unchanged.
 */
function repositoryPath(path, repository, pins = []) {
  if (!path) return path;
  const segments = bare(repository).split("/").filter(Boolean);
  const roots = [
    pinFor(repository, pins)?.path?.replace(/\/+$/, ""),
    segments.length >= 3 ? `vendor/repos/${segments.at(-2)}/${segments.at(-1)}` : undefined,
  ].filter(Boolean);
  for (const root of roots) {
    if (path === root) return ".";
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  }
  return path;
}

/** Paths follow the catalog's source-link convention: relative to the source repository. */
function targetsOf(catalog, repository) {
  const services = catalog.contexts.flatMap((context) => context.services);
  const belongs = (service) => service && bare(service.repo) === bare(repository);
  const targets = [];
  const add = (target, path, basis = "source-file") => {
    const normalized = repositoryPath(sourcePath(path), repository, catalog.repos ?? []);
    if (normalized) targets.push({ target, path: normalized, basis });
  };
  for (const service of services.filter(belongs)) {
    add({ kind: "service", id: service.id }, service.path || ".", "service-directory");
  }
  for (const flow of catalog.flows) {
    const lanes = flow.participants.filter((lane) => lane.kind === "service");
    const lane = lanes.find((lane) => lane.context === flow.owner) ?? lanes[0];
    if (!belongs(services.find((service) => service.id === lane?.id))) continue;
    add({ kind: "flow", id: flow.id }, flow.source);
    for (const step of steps(flow.steps)) {
      add({ kind: "step", id: step.id, flow: flow.id }, step.line);
      // A task attached to a step's source also belongs in the flow's work list.
      add({ kind: "flow", id: flow.id }, step.line);
    }
  }
  for (const adr of catalog.adrs) {
    // Org/context records do not identify one repository; leave them explicit.
    if (adr.scope.kind === "service" && belongs(services.find((service) => service.id === adr.scope.service))) add({ kind: "adr", id: adr.id }, adr.source);
  }
  for (const rfc of catalog.rfcs ?? []) {
    // Forge-backed RFCs already are work items. File-backed RFCs can be
    // associated with the implementation keys carried by commits touching
    // the proposal, without pretending the proposal and task are one thing.
    const ownedByRepository = rfc.repository
      ? bare(rfc.repository) === bare(repository)
      : rfc.scope.kind === "service" && belongs(services.find((service) => service.id === rfc.scope.service));
    if (rfc.sourceKind === "file" && ownedByRepository) add({ kind: "rfc", id: rfc.id }, rfc.source);
  }
  return targets;
}

export function issueKeys(message, projects) {
  return detectTaskKeys(message, { provider: "youtrack", projects });
}

/** The key a full scan is requested by: one verifier, named by its checkout, output and file. */
export function fullScanTarget(request) {
  return JSON.stringify([realpathSync(resolve(request.input.root)), resolve(request.input.output), request.options?.out ?? "work-items.json"]);
}

export function fullScanRequested(request, targets = []) {
  return !!request.input?.output && targets.includes(fullScanTarget(request));
}

// Read fixed-size pages against one pinned commit. A full scan has no commit
// cap, but does not accumulate the entire textual Git log in a single buffer.
// Reaching the cap is marked on `reading`, not warned about: the limit is one
// the verifier configured, met on every build of any long history, and a
// warning repeated that often hides the ones that are not expected.
export function* historyRecords(git, head, limit, reading = {}, pageSize = 200) {
  let seen = 0;
  for (let skip = 0; ; skip += pageSize) {
    const count = limit === null ? pageSize : Math.min(pageSize, limit + 1 - skip);
    const records = git(["log", head, `--skip=${skip}`, `-n${count}`, "--format=%x1e%H%x00%s%x00%an%x00%cI%x00%B%x00", "--name-only", "-z", "--no-renames", "--diff-merges=first-parent"]).split("\x1e").filter(Boolean);
    for (const record of records) {
      if (limit !== null && seen === limit) {
        reading.truncated = true;
        return;
      }
      seen++;
      yield record;
    }
    if (records.length < count) return;
  }
}

/**
 * Generation writes nothing. Every link names a commit, and a file cannot name
 * the commit it lands in: a commit mentioning a task that also carries the
 * regenerated links would add itself to them the moment it is made, and
 * `gen --check` could never agree (portolan.0020, after portolan.0010). The
 * host reads the links from the history where it reads the catalog, through
 * `scanWorkItems`; a fragment written by an earlier version is swept.
 */
export function run() {
  return { files: [], warnings: [] };
}

/**
 * The links the history holds for one verifier: a catalog fragment carrying
 * only `workItems` and `workItemLinks`, what made the reading incomplete, and
 * whether it stopped at `maxCommits` with older commits left unread.
 *
 * @param {{ input: { root: string, output?: string }, catalog: object, options?: object }} request
 * @param {{ fullScan?: string[] }} [scan]  full-scan targets requested for this reading
 */
export function scanWorkItems(request, { fullScan = [] } = {}) {
  const opts = request.options ?? {};
  const trackers = normalizeTrackers(opts.trackers);
  const empty = { contexts: [], defs: {}, flows: [], adrs: [], workItems: [], workItemLinks: [] };
  if (!trackers.length) return { fragment: empty, warnings: [], truncated: false };
  const root = realpathSync(resolve(request.input?.root ?? "."));
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  let top;
  try { top = realpathSync(git(["rev-parse", "--show-toplevel"]).trim()); }
  catch { throw new Error("work-items: input must be a Git checkout with local history"); }
  if (top !== root) throw new Error("work-items: set input to the Git checkout root; a nested or vendored directory must not inherit the enclosing repository's history");
  let origin = opts.repository;
  if (!origin) {
    try { origin = git(["remote", "get-url", "origin"]).trim(); }
    catch { throw new Error("work-items: no origin; set the repository web URL in options"); }
  }
  const repository = webRepository(origin);
  const max = opts.maxCommits ?? 500;
  if (!Number.isInteger(max) || max < 1 || max > 10000) throw new Error("work-items: maxCommits must be between 1 and 10000");
  const warnings = [];
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") warnings.push({ message: "work item history is incomplete: this checkout is shallow" });
  const head = git(["rev-parse", "HEAD"]).trim();
  const reading = { truncated: false };
  const records = historyRecords(git, head, fullScanRequested(request, fullScan) ? null : max, reading);
  const targets = targetsOf(request.catalog, repository);
  const items = new Map();
  const links = new Map();
  for (const record of records) {
    const [sha, subject, author, date, message, ...names] = record.split("\0");
    if (!/^[a-f0-9]{40,64}$/.test(sha)) continue;
    const paths = names.map((name) => name.replace(/^\n/, "")).filter(Boolean);
    const matched = targets.map((target) => ({ ...target, paths: paths.filter((path) => target.basis === "service-directory" ? target.path === "." || path === target.path || path.startsWith(`${target.path.replace(/\/$/, "")}/`) : path === target.path) })).filter((target) => target.paths.length);
    if (!matched.length) continue;
    for (const tracker of trackers) for (const key of detectTaskKeys(message, tracker)) {
      const id = `${tracker.id}:${key}`;
      items.set(id, { id, tracker: tracker.id, provider: tracker.provider, key, url: taskUrl(tracker, key) });
      for (const match of matched) {
        const linkKey = JSON.stringify([id, match.target, match.basis]);
        if (!links.has(linkKey)) links.set(linkKey, { workItem: id, target: match.target, basis: match.basis, commits: [] });
        const link = links.get(linkKey);
        const held = link.commits.find((commit) => commit.sha === sha);
        if (held) held.paths = [...new Set([...held.paths, ...match.paths])].sort();
        else link.commits.push({ repository, sha, subject, author, date, paths: [...new Set(match.paths)].sort() });
      }
    }
  }
  const fragment = { ...empty, workItems: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)), workItemLinks: [...links.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, link]) => link) };
  return { fragment, warnings, truncated: reading.truncated };
}
