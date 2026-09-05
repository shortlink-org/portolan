import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";

import { publicSetupFrom } from "../src/lib/setup-info.ts";
import { loadManifest } from "./manifest.mjs";

export const LOCAL_API_PREFIX = "/__portolan";
export const GENERATOR_EVENT_PREFIX = "::portolan-event::";

const SKIP = new Set([".git", ".portolan", "build", "dist", "node_modules", "target", "vendor"]);
const MAX_FILES = 12_000;
const jobs = new Map();
const SNAPSHOT_SKIP = new Set([".git", ".portolan", "dist", "node_modules", "target"]);

function safeRoot(workspace, input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Project path is required.");
  const clean = input.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) throw new Error("Project path must stay inside this repository.");
  const workspaceReal = realpathSync(workspace);
  const targetReal = realpathSync(resolve(workspaceReal, clean));
  if (targetReal !== workspaceReal && !targetReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new Error("Project path resolves outside this repository.");
  }
  const root = relative(workspaceReal, targetReal).replaceAll(sep, "/") || ".";
  return { root, absolute: targetReal };
}

function walk(root) {
  const files = new Set();
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length && files.size < MAX_FILES) {
    const current = pending.pop();
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const name = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const absolute = join(current.absolute, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) pending.push({ absolute, relative: name });
      else if (stat.isFile()) files.add(name);
      if (files.size >= MAX_FILES) break;
    }
  }
  return files;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function matches(files, pattern) {
  return [...files].filter((name) => pattern.test(name)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

function compactDirectories(paths) {
  const directories = [...new Set(paths.map((name) => posix.dirname(name)))].sort((a, b) => a.length - b.length);
  return directories.filter((dir, index) => !directories.some((parent, other) => other < index && (dir === parent || dir.startsWith(`${parent}/`))));
}

function detected(plugin, candidates, options = {}, label = candidates[0], ambiguous = false) {
  if (!candidates.length) return null;
  return {
    plugin,
    confidence: ambiguous && candidates.length > 1 ? "medium" : "high",
    evidence: label,
    candidates,
    options,
    selected: true,
  };
}

function detectionsFor(files) {
  const openapi = matches(files, /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i);
  const asyncapi = matches(files, /(^|\/)asyncapi[^/]*\.(ya?ml|json)$/i);
  const graphql = matches(files, /\.graphqls?$/i);
  const protos = matches(files, /\.proto$/i);
  const sql = matches(files, /(^|\/)(migrations?|repository)(\/|.*\/).*\.sql$/i);
  const adrs = matches(files, /(^|\/)(docs\/adr|adr)\/.*\.md$/i);
  const glossaries = matches(files, /(^|\/)glossary\.md$/i);
  const sqlRoot = sql.map((name) => {
    const segments = name.split("/");
    const repository = segments.findIndex((part) => /^(repository|repositories)$/i.test(part));
    return repository >= 0 ? segments.slice(0, repository + 1).join("/") : "";
  }).find(Boolean);
  const graphqlDirs = compactDirectories(graphql);
  const protoDirs = compactDirectories(protos);
  return [
    detected("go-domain", files.has("go.mod") ? ["go.mod"] : []),
    detected("ts-domain", ["package.json", "tsconfig.json"].filter((name) => files.has(name))),
    detected("rust-domain", files.has("Cargo.toml") ? ["Cargo.toml"] : []),
    detected("java-domain", ["pom.xml", "build.gradle", "build.gradle.kts"].filter((name) => files.has(name))),
    detected("django-domain", files.has("manage.py") ? ["manage.py"] : []),
    detected("openapi", openapi, openapi[0] ? { spec: openapi[0] } : {}, openapi[0], true),
    detected("asyncapi", asyncapi, asyncapi[0] ? { spec: asyncapi[0] } : {}, asyncapi[0], true),
    detected("graphql", graphql, graphqlDirs[0] ? { schema: graphqlDirs.length === 1 ? graphqlDirs[0] : graphql[0] } : {}, graphqlDirs.length === 1 ? graphqlDirs[0] : graphql[0]),
    detected("proto", protos, protoDirs.length ? { paths: protoDirs } : {}, protoDirs.join(", ")),
    detected("sql", sql, sqlRoot ? { repositories: sqlRoot } : {}, sqlRoot || sql[0]),
    detected("adr", adrs, adrs[0] ? { files: [`${posix.dirname(adrs[0])}/*.md`] } : {}, adrs[0] ? `${posix.dirname(adrs[0])}/*.md` : undefined),
    detected("glossary", glossaries, glossaries.length ? { files: glossaries } : {}, glossaries.join(", ")),
  ].filter(Boolean);
}

export function discoverProject(workspace, input) {
  const { root, absolute } = safeRoot(workspace, input);
  const files = walk(absolute);
  const detections = detectionsFor(files);
  const id = slug(basename(absolute)) || "service";
  return {
    root,
    filesScanned: files.size,
    truncated: files.size >= MAX_FILES,
    defaults: { id, name: id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "), context: id, service: id },
    detections,
  };
}

function repositoryParts(repository) {
  const value = String(repository ?? "").trim();
  if (!value || value.startsWith("-") || /[\r\n\0]/.test(value)) throw new Error("Repository URL is required.");
  let path;
  let host;
  let fetchUrl = value;
  if (value.startsWith("git@")) {
    const match = /^git@([^:/\s]+):(.+)$/.exec(value);
    if (!match) throw new Error("Use a valid SSH repository URL.");
    [, host, path] = match;
  }
  else if (value.includes("://")) {
    const url = new URL(value);
    const embeddedCredentials = url.protocol === "https:" ? Boolean(url.username || url.password) : Boolean(url.password);
    if (!["https:", "ssh:"].includes(url.protocol) || embeddedCredentials) throw new Error("Use an HTTPS or SSH repository URL without embedded credentials.");
    host = url.hostname;
    path = url.pathname;
  } else {
    if (!/^[a-z0-9.-]+\/[a-z0-9._/-]+$/i.test(value)) throw new Error("Repository must name a host, owner and repository.");
    host = value.slice(0, value.indexOf("/"));
    path = value.slice(value.indexOf("/") + 1);
    fetchUrl = `https://${value}`;
  }
  const segments = path.replace(/^\//, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) throw new Error("Repository must name an owner and repository.");
  return { value, fetchUrl, host, owner: segments.at(-2), name: segments.at(-1), web: `${host}/${segments.at(-2)}/${segments.at(-1)}` };
}

function remoteCommit(repository, ref) {
  if (ref.startsWith("-") || /[\s\r\n\0]/.test(ref)) throw new Error("Branch, tag or commit is not valid.");
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
  const query = ref.trim() || "HEAD";
  const output = execFileSync("git", ["ls-remote", "--quiet", repository, query, `${query}^{}`], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const lines = output.trim().split("\n").filter(Boolean);
  const peeled = lines.find((line) => line.trimEnd().endsWith("^{}"));
  const commit = (peeled ?? lines[0] ?? "").trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Repository has no ref \"${query}\".`);
  return commit.toLowerCase();
}

function inspectionKey(repository, commit, sourcePath = "") {
  return createHash("sha256").update(`${repository}\0${commit}\0${sourcePath}`).digest("hex").slice(0, 16);
}

function cleanSourcePath(sourcePath) {
  const clean = String(sourcePath ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.startsWith("/") || clean.startsWith("-") || clean.split("/").includes("..")) throw new Error("Repository path must be relative.");
  return clean;
}

export function inspectionRoot(repository, commit, sourcePath = "") {
  const clean = cleanSourcePath(sourcePath);
  return [".portolan", "inspect", inspectionKey(repository, commit, clean), clean].filter(Boolean).join("/");
}

export function prepareRepository(workspace, request) {
  const repo = repositoryParts(request.repository);
  const ref = String(request.ref ?? "").trim();
  const sourcePath = cleanSourcePath(request.sourcePath);
  const commit = remoteCommit(repo.fetchUrl, ref);
  const root = inspectionRoot(repo.value, commit, sourcePath);
  const checkout = join(workspace, ".portolan", "inspect", inspectionKey(repo.value, commit, sourcePath));
  if (!lstatExists(checkout)) {
    mkdirSync(dirname(checkout), { recursive: true });
    const staging = mkdtempSync(join(dirname(checkout), ".checkout-"));
    try {
      const options = { cwd: staging, stdio: "pipe", timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } };
      execFileSync("git", ["init", "--quiet"], options);
      execFileSync("git", ["fetch", "--quiet", "--depth", "1", repo.fetchUrl, commit], options);
      if (sourcePath) execFileSync("git", ["sparse-checkout", "set", "--no-cone", sourcePath], options);
      execFileSync("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], options);
      renameSync(staging, checkout);
    } catch (cause) {
      throw new Error(`Could not inspect repository: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`);
    } finally {
      if (lstatExists(staging)) rmSync(staging, { recursive: true, force: true });
    }
  }
  if (sourcePath && !lstatExists(join(checkout, sourcePath))) throw new Error(`Repository path \"${sourcePath}\" does not exist at ${commit.slice(0, 7)}.`);
  const discovery = discoverProject(workspace, root);
  return { repository: repo.value, ref, commit, sourcePath, checkoutRoot: root, discovery };
}

function lstatExists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

function pluginOptions(plugin, project, detectedOptions = {}) {
  const common = { context: project.context, service: project.service };
  if (["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain"].includes(plugin)) {
    return { ...common, ...(project.repository ? { repo: repositoryParts(project.repository).web } : {}), ...detectedOptions, out: "domain.json" };
  }
  if (plugin === "sql") return { ...common, store: "pg", ...detectedOptions, out: "stores.json" };
  if (plugin === "openapi") return { ...common, ...detectedOptions, out: "api.json" };
  if (plugin === "asyncapi") return { ...common, ...detectedOptions, out: "bus.json" };
  if (plugin === "graphql") return { ...common, ...detectedOptions, out: "graphql.json" };
  if (plugin === "proto") return { ...common, ...detectedOptions, out: "proto.json" };
  if (plugin === "glossary") return { context: project.context, ...detectedOptions, out: "glossary.json" };
  if (plugin === "adr") return { ...detectedOptions, out: "adr.json" };
  return {};
}

export function planProject(workspace, manifest, request) {
  const external = request.source === "external";
  const repo = external ? repositoryParts(request.repository) : null;
  const sourcePath = external ? cleanSourcePath(request.sourcePath) : "";
  if (external && !/^[0-9a-f]{40}$/i.test(String(request.commit ?? ""))) throw new Error("Inspect the repository to resolve an immutable commit first.");
  const inspectedRoot = external ? inspectionRoot(repo.value, String(request.commit), sourcePath) : request.root;
  const discovery = discoverProject(workspace, inspectedRoot);
  const declared = new Set((manifest.plugins ?? []).map((plugin) => plugin.name));
  const detected = new Set(discovery.detections.map((item) => item.plugin));
  const requested = Array.isArray(request.plugins) ? request.plugins : [];
  const plugins = [...new Set(requested)].filter((plugin) => detected.has(plugin) && declared.has(plugin));
  if (plugins.length === 0) throw new Error("Select at least one detected plugin that is declared in portolan.json.");
  const id = slug(String(request.id ?? ""));
  if (!id) throw new Error("Project id must contain letters or numbers.");
  if ((manifest.projects ?? []).some((project) => project.id === id)) throw new Error(`Project id \"${id}\" already exists.`);
  const finalRoot = external
    ? ["vendor", "repos", repo.owner, repo.name, sourcePath].filter(Boolean).join("/")
    : discovery.root;
  if ((manifest.projects ?? []).some((project) => project.root === finalRoot)) throw new Error(`Project path \"${finalRoot}\" already exists.`);
  const project = {
    id,
    name: String(request.name ?? "").trim() || discovery.defaults.name,
    root: finalRoot,
    ...(String(request.context ?? "").trim() ? { context: slug(String(request.context)) } : {}),
    ...(String(request.service ?? "").trim() ? { service: slug(String(request.service)) } : {}),
    ...(String(request.repository ?? "").trim() ? { repository: String(request.repository).trim() } : {}),
  };
  const out = `${finalRoot}/portolan`;
  const detectionByPlugin = new Map(discovery.detections.map((item) => [item.plugin, item]));
  const steps = plugins.map((plugin) => ({ plugin, in: finalRoot, out, options: pluginOptions(plugin, project, detectionByPlugin.get(plugin)?.options) }));
  const source = external ? "vendor/repos/**/portolan/*.json" : `${out}/*.json`;
  const fetch = external ? { repo: repo.value, commit: String(request.commit), paths: sourcePath ? [sourcePath] : [] } : null;
  return { project, plugins, steps, source, discovery, fetch };
}

export function writeProject(workspace, request) {
  const manifestPath = join(workspace, "portolan.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const plan = planProject(workspace, manifest, request);
  const fetchIndex = (manifest.extract ?? []).findIndex((step) => step.plugin === "git");
  const extract = [...(manifest.extract ?? [])];
  if (plan.fetch) {
    if (!manifest.plugins?.some((plugin) => plugin.name === "git")) throw new Error("The built-in git fetcher is not declared in portolan.json.");
    if (fetchIndex >= 0) {
      const fetchStep = extract[fetchIndex];
      extract[fetchIndex] = { ...fetchStep, options: { ...fetchStep.options, repos: [...(fetchStep.options?.repos ?? []), plan.fetch] } };
    } else {
      extract.unshift({ plugin: "git", in: "vendor", out: "vendor/repos", options: { cache: "vendor/repos", repos: [plan.fetch] } });
    }
  }
  extract.push(...plan.steps);
  const next = {
    ...manifest,
    projects: [...(manifest.projects ?? []), plan.project],
    sources: [...new Set([...(manifest.sources ?? []), ...(plan.fetch ? ["vendor/repos/*/*/git.repo.json"] : []), plan.source])],
    extract,
  };
  const staging = mkdtempSync(join(dirname(manifestPath), ".portolan-manifest-"));
  const temp = join(staging, "portolan.json");
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
    const validation = loadManifest(temp);
    if (validation.problems.length) throw new Error(validation.problems.join("\n"));
    renameSync(temp, manifestPath);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return plan;
}

function setup(workspace) {
  const manifestText = readFileSync(join(workspace, "portolan.json"), "utf8");
  let report;
  try { report = JSON.parse(readFileSync(join(workspace, ".portolan/build-report.json"), "utf8")); } catch {}
  return publicSetupFrom(JSON.parse(manifestText), report, createHash("sha256").update(manifestText).digest("hex"));
}

function send(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(value)}\n`);
}

async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 64 * 1024) throw new Error("Request body is too large.");
  }
  return text ? JSON.parse(text) : {};
}

function localRequest(req) {
  const address = req.socket.remoteAddress ?? "";
  const localAddress = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  const authority = String(req.headers.host ?? "");
  const host = authority.startsWith("[") ? authority.slice(1, authority.indexOf("]")) : authority.split(":")[0];
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(host);
  let localOrigin = true;
  if (req.headers.origin) {
    try { localOrigin = ["localhost", "127.0.0.1", "::1"].includes(new URL(req.headers.origin).hostname); }
    catch { localOrigin = false; }
  }
  return localAddress && localHost && localOrigin;
}

function emit(job, event) {
  const enriched = { at: new Date().toISOString(), ...event };
  job.events.push(enriched);
  for (const response of job.subscribers) response.write(`data: ${JSON.stringify(enriched)}\n\n`);
}

function feed(job, stream, chunk) {
  job.buffers[stream] += String(chunk);
  const lines = job.buffers[stream].split(/\r?\n/);
  job.buffers[stream] = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(GENERATOR_EVENT_PREFIX)) {
      try { emit(job, JSON.parse(line.slice(GENERATOR_EVENT_PREFIX.length))); } catch { emit(job, { type: "log", stream, message: line }); }
    } else emit(job, { type: "log", stream, message: line });
  }
}

function workspaceFingerprint(workspace) {
  const hash = createHash("sha256");
  try {
    const options = { cwd: workspace, encoding: "buffer", maxBuffer: 128 * 1024 * 1024 };
    hash.update(execFileSync("git", ["diff", "--binary", "HEAD", "--", "."], options));
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], options)
      .toString().split("\0").filter(Boolean).sort();
    for (const name of untracked) {
      hash.update(name); hash.update("\0");
      try { hash.update(readFileSync(join(workspace, name))); } catch {}
    }
  } catch {
    const pending = [workspace];
    const files = [];
    while (pending.length) {
      const dir = pending.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SNAPSHOT_SKIP.has(entry.name) || entry.name === "build" && relative(workspace, dir).startsWith("plugins")) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) files.push(path);
      }
    }
    for (const path of files.sort()) { hash.update(relative(workspace, path)); hash.update("\0"); hash.update(readFileSync(path)); }
  }
  return hash.digest("hex");
}

function snapshotWorkspace(workspace) {
  const holder = mkdtempSync(join(tmpdir(), "portolan-preview-"));
  const snapshot = join(holder, "workspace");
  cpSync(workspace, snapshot, {
    recursive: true,
    filter(source) {
      const name = relative(workspace, source).replaceAll(sep, "/");
      if (!name) return true;
      return !name.split("/").some((segment) => SNAPSHOT_SKIP.has(segment) || segment === "build" && name.startsWith("plugins/"));
    },
  });
  symlinkSync(join(workspace, "node_modules"), join(snapshot, "node_modules"), "dir");
  const gitMetadata = join(workspace, ".git");
  if (lstatExists(gitMetadata)) symlinkSync(gitMetadata, join(snapshot, ".git"), lstatSync(gitMetadata).isDirectory() ? "dir" : "file");
  return { holder, snapshot };
}

function fileDiff(workspace, snapshot, change) {
  const before = join(workspace, change.path);
  const after = join(snapshot, change.path);
  const left = lstatExists(before) ? before : "/dev/null";
  const right = lstatExists(after) ? after : "/dev/null";
  if ((lstatExists(before) && statSync(before).size > 512_000) || (lstatExists(after) && statSync(after).size > 512_000)) {
    return { path: change.path, status: change.kind, diff: "Binary or large file changed; textual diff omitted." };
  }
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--no-index", "--no-ext-diff", "--unified=3", "--", left, right], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  } catch (cause) {
    if (cause?.status !== 1) throw cause;
    diff = String(cause.stdout ?? "");
  }
  const portable = diff
    .replaceAll(`a${before}`, `a/${change.path}`)
    .replaceAll(`b${after}`, `b/${change.path}`)
    .replaceAll(before, change.path)
    .replaceAll(after, change.path);
  return { path: change.path, status: change.kind, diff: portable.slice(0, 200_000) };
}

export function diffGeneratedFiles(workspace, snapshot, events) {
  const changes = new Map();
  for (const event of events) {
    if (event.type !== "step-finished") continue;
    for (const change of event.changes ?? []) changes.set(change.path, change);
  }
  const all = [...changes.values()];
  let remaining = 2 * 1024 * 1024;
  let contentTruncated = false;
  const shown = all.slice(0, 100).map((change) => {
    const file = fileDiff(workspace, snapshot, change);
    if (file.diff.length > remaining) { file.diff = `${file.diff.slice(0, Math.max(0, remaining))}\n… diff truncated`; contentTruncated = true; }
    remaining = Math.max(0, remaining - file.diff.length);
    return file;
  });
  return { files: shown, totalFiles: all.length, truncated: all.length > shown.length || contentTruncated };
}

function startJob(workspace, mode, approvedPreview) {
  const id = randomUUID();
  const preview = mode === "preview";
  const fingerprint = preview ? workspaceFingerprint(workspace) : approvedPreview?.fingerprint;
  const snapshot = preview ? snapshotWorkspace(workspace) : null;
  if (preview && workspaceFingerprint(workspace) !== fingerprint) {
    rmSync(snapshot.holder, { recursive: true, force: true });
    throw new Error("Files changed while the preview workspace was being created. Try again.");
  }
  const generatedAt = preview ? new Date().toISOString() : approvedPreview?.generatedAt;
  const job = { id, mode, status: "running", events: [], subscribers: new Set(), buffers: { stdout: "", stderr: "" }, child: null, runRoot: snapshot?.snapshot ?? workspace, snapshotHolder: snapshot?.holder ?? null, fingerprint, generatedAt };
  jobs.set(id, job);
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", mode === "check" ? "gen:check" : "gen"], {
    cwd: job.runRoot,
    env: { ...process.env, PORTOLAN_EVENTS: "1", ...(generatedAt ? { PORTOLAN_GENERATED_AT: generatedAt } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  job.child = child;
  emit(job, { type: "run-started", runId: id, mode });
  child.stdout.on("data", (chunk) => feed(job, "stdout", chunk));
  child.stderr.on("data", (chunk) => feed(job, "stderr", chunk));
  child.on("error", (error) => emit(job, { type: "run-finished", status: "failed", message: error.message }));
  child.on("close", (code, signal) => {
    for (const stream of ["stdout", "stderr"]) if (job.buffers[stream]) emit(job, { type: "log", stream, message: job.buffers[stream] });
    job.status = signal ? "cancelled" : code === 0 ? "ok" : "failed";
    if (preview && job.status !== "cancelled") {
      try { job.preview = diffGeneratedFiles(workspace, job.runRoot, job.events); emit(job, { type: "preview-ready", ...job.preview }); }
      catch (cause) { job.status = "failed"; emit(job, { type: "log", stream: "stderr", message: `Could not build preview: ${cause instanceof Error ? cause.message : String(cause)}` }); }
    }
    emit(job, { type: "process-finished", status: job.status, code, signal });
    for (const response of job.subscribers) response.end();
    job.subscribers.clear();
    if (job.snapshotHolder) rmSync(job.snapshotHolder, { recursive: true, force: true });
  });
  return job;
}

export function localApiPlugin(workspace = process.cwd()) {
  return {
    name: "portolan-local-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith(LOCAL_API_PREFIX)) return next();
        if (!localRequest(req)) return send(res, 403, { error: "The local API is available only through localhost." });
        try {
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/status`) {
            const active = [...jobs.values()].find((job) => job.status === "running");
            return send(res, 200, { local: true, setup: setup(workspace), activeRun: active ? { id: active.id, mode: active.mode } : null });
          }
          const eventMatch = url.pathname.match(/^\/__portolan\/runs\/([^/]+)\/events$/);
          if (req.method === "GET" && eventMatch) {
            const job = jobs.get(eventMatch[1]);
            if (!job) return send(res, 404, { error: "Generation run not found." });
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            for (const event of job.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
            if (job.status === "running") job.subscribers.add(res); else res.end();
            req.on("close", () => job.subscribers.delete(res));
            return;
          }
          if (req.method !== "POST" || req.headers["content-type"]?.split(";")[0] !== "application/json" || req.headers["x-portolan-local"] !== "1") {
            return send(res, 405, { error: "Use a local JSON request." });
          }
          const input = await body(req);
          if (url.pathname === `${LOCAL_API_PREFIX}/repositories/prepare`) return send(res, 200, prepareRepository(workspace, input));
          if (url.pathname === `${LOCAL_API_PREFIX}/discover`) return send(res, 200, discoverProject(workspace, input.path));
          if (url.pathname === `${LOCAL_API_PREFIX}/projects/preview`) {
            const manifest = JSON.parse(readFileSync(join(workspace, "portolan.json"), "utf8"));
            return send(res, 200, planProject(workspace, manifest, input));
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/projects`) {
            const result = writeProject(workspace, input);
            return send(res, 201, { ...result, setup: setup(workspace) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/runs`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const mode = ["check", "preview"].includes(input.mode) ? input.mode : "write";
            let approvedPreview = null;
            if (mode === "write") {
              approvedPreview = jobs.get(input.previewRunId);
              if (!approvedPreview?.preview || approvedPreview.status !== "ok") return send(res, 409, { error: "Preview the generated diff before applying it." });
              if (workspaceFingerprint(workspace) !== approvedPreview.fingerprint) return send(res, 409, { error: "Files changed after this preview. Run the preview again." });
            }
            const job = startJob(workspace, mode, approvedPreview);
            return send(res, 202, { runId: job.id, mode });
          }
          const cancelMatch = url.pathname.match(/^\/__portolan\/runs\/([^/]+)\/cancel$/);
          if (cancelMatch) {
            const job = jobs.get(cancelMatch[1]);
            if (!job || job.status !== "running") return send(res, 404, { error: "Active generation run not found." });
            if (process.platform !== "win32" && job.child.pid) process.kill(-job.child.pid, "SIGTERM");
            else job.child.kill("SIGTERM");
            return send(res, 202, { runId: job.id, status: "cancelling" });
          }
          return send(res, 404, { error: "Local API route not found." });
        } catch (error) {
          return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
