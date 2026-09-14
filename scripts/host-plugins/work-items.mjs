import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import options from "./work-items.options.json" with { type: "json" };
import { detectTaskKeys, normalizeTrackers, taskUrl } from "../../src/lib/task-tracker-config.mjs";

export function describe() {
  return { name: "work-items", summary: "Connects YouTrack issue keys in Git commits to flows, steps, services and decisions, retaining the source of each association.", category: "evidence", phases: ["verify"], options };
}

function webRepository(value) {
  const normalized = value.trim().replace(/^git@([^:]+):/, "https://$1/").replace(/^ssh:\/\/git@/, "https://").replace(/\.git\/?$/, "").replace(/\/$/, "");
  const url = new URL(normalized);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("work-items: repository must be an HTTP(S) web URL without credentials, query or fragment");
  return normalized;
}

function bare(value) {
  return String(value ?? "").replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
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

/** Paths follow the catalog's source-link convention: relative to the source repository. */
function targetsOf(catalog, repository) {
  const services = catalog.contexts.flatMap((context) => context.services);
  const belongs = (service) => service && bare(service.repo) === bare(repository);
  const targets = [];
  const add = (target, path, basis = "source-file") => {
    const normalized = sourcePath(path);
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
  return targets;
}

export function issueKeys(message, projects) {
  return detectTaskKeys(message, { projects });
}

export function fullScanRequested(request, target = process.env.PORTOLAN_WORK_ITEMS_FULL_SCAN) {
  return !!request.input?.output && target === JSON.stringify([
    realpathSync(resolve(request.input.root)), resolve(request.input.output), request.options?.out ?? "work-items.json",
  ]);
}

// Read fixed-size pages against one pinned commit. A full scan has no commit
// cap, but does not accumulate the entire textual Git log in a single buffer.
export function* historyRecords(git, head, limit, warnings, pageSize = 200) {
  let seen = 0;
  for (let skip = 0; ; skip += pageSize) {
    const count = limit === null ? pageSize : Math.min(pageSize, limit + 1 - skip);
    const records = git(["log", head, `--skip=${skip}`, `-n${count}`, "--format=%x1e%H%x00%s%x00%an%x00%cI%x00%B%x00", "--name-only", "-z", "--no-renames", "--diff-merges=first-parent"]).split("\x1e").filter(Boolean);
    for (const record of records) {
      if (limit !== null && seen === limit) {
        warnings.push({ message: `work item history is limited to the latest ${limit} reachable commits` });
        return;
      }
      seen++;
      yield record;
    }
    if (records.length < count) return;
  }
}

export function run(request) {
  const opts = request.options ?? {};
  const trackers = normalizeTrackers(opts.trackers);
  // Keeping a disabled verifier writes an empty fragment, clearing old links
  // during generation without deleting files from the settings request.
  if (!trackers.length) return { files: [{ name: opts.out ?? "work-items.json", contents: `${JSON.stringify({ contexts: [], defs: {}, flows: [], adrs: [], workItems: [], workItemLinks: [] }, null, 2)}\n` }], warnings: [] };
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
  const records = historyRecords(git, head, fullScanRequested(request) ? null : max, warnings);
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
  const fragment = { contexts: [], defs: {}, flows: [], adrs: [], workItems: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)), workItemLinks: [...links.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, link]) => link) };
  return { files: [{ name: opts.out ?? "work-items.json", contents: `${JSON.stringify(fragment, null, 2)}\n` }], warnings };
}
