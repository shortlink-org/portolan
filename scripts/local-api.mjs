import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { publicSetupFrom } from "../src/lib/setup-info.ts";
import { loadManifest } from "./manifest.mjs";

export const LOCAL_API_PREFIX = "/__portolan";
export const GENERATOR_EVENT_PREFIX = "::portolan-event::";

const SKIP = new Set([".git", ".portolan", "build", "dist", "node_modules", "target", "vendor"]);
const MAX_FILES = 12_000;
const jobs = new Map();

const RULES = [
  { plugin: "go-domain", confidence: "high", test: (files) => files.has("go.mod"), evidence: "go.mod" },
  { plugin: "ts-domain", confidence: "high", test: (files) => files.has("package.json") || files.has("tsconfig.json"), evidence: "package.json or tsconfig.json" },
  { plugin: "rust-domain", confidence: "high", test: (files) => files.has("Cargo.toml"), evidence: "Cargo.toml" },
  { plugin: "java-domain", confidence: "high", test: (files) => ["pom.xml", "build.gradle", "build.gradle.kts"].some((name) => files.has(name)), evidence: "Maven or Gradle build" },
  { plugin: "django-domain", confidence: "high", test: (files) => files.has("manage.py"), evidence: "manage.py" },
  { plugin: "openapi", confidence: "high", test: (files) => [...files].some((name) => /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i.test(name)), evidence: "OpenAPI document" },
  { plugin: "asyncapi", confidence: "high", test: (files) => [...files].some((name) => /(^|\/)asyncapi[^/]*\.(ya?ml|json)$/i.test(name)), evidence: "AsyncAPI document" },
  { plugin: "graphql", confidence: "high", test: (files) => [...files].some((name) => /\.graphqls?$/i.test(name)), evidence: "GraphQL schema" },
  { plugin: "proto", confidence: "high", test: (files) => [...files].some((name) => /\.proto$/i.test(name)), evidence: "Protocol Buffer definitions" },
  { plugin: "sql", confidence: "high", test: (files) => [...files].some((name) => /(^|\/)(migrations?|repository)(\/|.*\/).*\.sql$/i.test(name)), evidence: "SQL migrations" },
  { plugin: "adr", confidence: "high", test: (files) => [...files].some((name) => /(^|\/)docs\/adr\/.*\.md$/i.test(name)), evidence: "docs/adr Markdown files" },
  { plugin: "glossary", confidence: "high", test: (files) => [...files].some((name) => /(^|\/)glossary\.md$/i.test(name)), evidence: "GLOSSARY.md" },
];

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

export function discoverProject(workspace, input) {
  const { root, absolute } = safeRoot(workspace, input);
  const files = walk(absolute);
  const detections = RULES.filter((rule) => rule.test(files)).map(({ plugin, confidence, evidence }) => ({
    plugin,
    confidence,
    evidence,
    selected: confidence === "high",
  }));
  const id = slug(basename(absolute)) || "service";
  return {
    root,
    filesScanned: files.size,
    truncated: files.size >= MAX_FILES,
    defaults: { id, name: id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "), context: id, service: id },
    detections,
  };
}

function pluginOptions(plugin, project) {
  const common = { context: project.context, service: project.service };
  if (["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain"].includes(plugin)) {
    return { ...common, ...(project.repository ? { repo: project.repository.replace(/^https?:\/\//, "").replace(/\.git$/, "") } : {}), out: "domain.json" };
  }
  if (plugin === "sql") return { ...common, store: "pg", out: "stores.json" };
  if (plugin === "openapi") return { ...common, out: "api.json" };
  if (plugin === "asyncapi") return { ...common, out: "bus.json" };
  if (plugin === "graphql") return { ...common, out: "graphql.json" };
  if (plugin === "proto") return { ...common, out: "proto.json" };
  if (plugin === "glossary") return { context: project.context, out: "glossary.json" };
  if (plugin === "adr") return { out: "adr.json" };
  return {};
}

export function planProject(workspace, manifest, request) {
  const discovery = discoverProject(workspace, request.root);
  const declared = new Set((manifest.plugins ?? []).map((plugin) => plugin.name));
  const detected = new Set(discovery.detections.map((item) => item.plugin));
  const requested = Array.isArray(request.plugins) ? request.plugins : [];
  const plugins = [...new Set(requested)].filter((plugin) => detected.has(plugin) && declared.has(plugin));
  if (plugins.length === 0) throw new Error("Select at least one detected plugin that is declared in portolan.json.");
  const id = slug(String(request.id ?? ""));
  if (!id) throw new Error("Project id must contain letters or numbers.");
  if ((manifest.projects ?? []).some((project) => project.id === id)) throw new Error(`Project id \"${id}\" already exists.`);
  if ((manifest.projects ?? []).some((project) => project.root === discovery.root)) throw new Error(`Project path \"${discovery.root}\" already exists.`);
  const project = {
    id,
    name: String(request.name ?? "").trim() || discovery.defaults.name,
    root: discovery.root,
    ...(String(request.context ?? "").trim() ? { context: slug(String(request.context)) } : {}),
    ...(String(request.service ?? "").trim() ? { service: slug(String(request.service)) } : {}),
    ...(String(request.repository ?? "").trim() ? { repository: String(request.repository).trim() } : {}),
  };
  const out = `${discovery.root}/portolan`;
  const steps = plugins.map((plugin) => ({ plugin, in: discovery.root, out, options: pluginOptions(plugin, project) }));
  const source = `${out}/*.json`;
  return { project, plugins, steps, source, discovery };
}

export function writeProject(workspace, request) {
  const manifestPath = join(workspace, "portolan.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const plan = planProject(workspace, manifest, request);
  const next = {
    ...manifest,
    projects: [...(manifest.projects ?? []), plan.project],
    sources: (manifest.sources ?? []).includes(plan.source) ? manifest.sources : [...(manifest.sources ?? []), plan.source],
    extract: [...(manifest.extract ?? []), ...plan.steps],
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

function startJob(workspace, mode) {
  const id = randomUUID();
  const job = { id, mode, status: "running", events: [], subscribers: new Set(), buffers: { stdout: "", stderr: "" }, child: null };
  jobs.set(id, job);
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", mode === "check" ? "gen:check" : "gen"], {
    cwd: workspace,
    env: { ...process.env, PORTOLAN_EVENTS: "1" },
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
    emit(job, { type: "process-finished", status: job.status, code, signal });
    for (const response of job.subscribers) response.end();
    job.subscribers.clear();
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
            const mode = input.mode === "check" ? "check" : "write";
            const job = startJob(workspace, mode);
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
