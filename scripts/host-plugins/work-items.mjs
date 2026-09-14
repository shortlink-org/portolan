import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import options from "./work-items.options.json" with { type: "json" };

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
  const configured = new Set(projects);
  return [...new Set([...message.matchAll(/(?<![A-Za-z0-9_-])([A-Z][A-Z0-9_]*)-([0-9]+)(?![A-Za-z0-9_-])/g)]
    .filter((match) => configured.has(match[1])).map((match) => match[0]))].sort();
}

export function run(request) {
  const opts = request.options ?? {};
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
  const trackers = opts.trackers ?? [];
  const ids = new Set();
  const projects = new Set();
  for (const tracker of trackers) {
    if (ids.has(tracker.id) || !/^[a-z0-9][a-z0-9-]*$/.test(tracker.id) || tracker.provider !== "youtrack") throw new Error("work-items: tracker IDs must be unique and provider must be youtrack");
    ids.add(tracker.id);
    const base = new URL(tracker.baseUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("work-items: tracker baseUrl must be an HTTP(S) URL without credentials, query or fragment");
    for (const project of tracker.projects) {
      if (projects.has(project)) throw new Error(`work-items: project ${project} matches more than one tracker in this checkout`);
      projects.add(project);
    }
  }
  if (!trackers.length) throw new Error("work-items: configure at least one tracker");
  const max = opts.maxCommits ?? 500;
  if (!Number.isInteger(max) || max < 1 || max > 10000) throw new Error("work-items: maxCommits must be between 1 and 10000");
  const warnings = [];
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") warnings.push({ message: "work item history is incomplete: this checkout is shallow" });
  const records = git(["log", "HEAD", `-n${max + 1}`, "--format=%x1e%H%x00%s%x00%an%x00%cI%x00%B%x00", "--name-only", "-z", "--no-renames", "--diff-merges=first-parent"]).split("\x1e").filter(Boolean);
  if (records.length > max) warnings.push({ message: `work item history is limited to the latest ${max} reachable commits` });
  const targets = targetsOf(request.catalog, repository);
  const items = new Map();
  const links = new Map();
  for (const record of records.slice(0, max)) {
    const [sha, subject, author, date, message, ...names] = record.split("\0");
    if (!/^[a-f0-9]{40,64}$/.test(sha)) continue;
    const paths = names.map((name) => name.replace(/^\n/, "")).filter(Boolean);
    const matched = targets.map((target) => ({ ...target, paths: paths.filter((path) => target.basis === "service-directory" ? target.path === "." || path === target.path || path.startsWith(`${target.path.replace(/\/$/, "")}/`) : path === target.path) })).filter((target) => target.paths.length);
    if (!matched.length) continue;
    for (const tracker of trackers) for (const key of issueKeys(message, tracker.projects)) {
      const id = `${tracker.id}:${key}`;
      items.set(id, { id, tracker: tracker.id, provider: tracker.provider, key, url: `${tracker.baseUrl.replace(/\/$/, "")}/issue/${encodeURIComponent(key)}` });
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
