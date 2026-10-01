// A trial: a project or a recording tried in a snapshot of the workspace
// before it is applied, what the extractors found there, and the preview
// server a project trial is shown on.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { dirname, join, posix } from "node:path";

import { readManifest, readManifestText } from "../manifest.mjs";
import { builtinPluginNames } from "../builtin-plugins.mjs";
import { checkRecording, manifestWithTraceStep, recordingPath, stepWithMappings, traceStepFor } from "../trace-trials.mjs";
import { lstatExists, snapshotWorkspace, workspaceFingerprint } from "./workspace.mjs";
import { writeManifest } from "./manifest-file.mjs";
import { manifestWithProject, projectRequestPlan, rememberManifestUndo } from "./projects.mjs";

const PROJECT_PREVIEW_TTL_MS = 15 * 60 * 1000;

const TRIAL_FACTS = [
  ["contexts", "contexts"],
  ["services", "components"],
  ["contracts", "API contracts"],
  ["apiOperations", "API operations"],
  ["integrations", "integrations"],
  ["aggregates", "aggregates"],
  ["entities", "entities"],
  ["domainOperations", "domain operations"],
  ["events", "domain events"],
  ["channels", "message channels"],
  ["messages", "messages"],
  ["stores", "data stores"],
  ["tables", "tables"],
  ["keyPatterns", "key patterns"],
  ["flows", "flows"],
  ["adrs", "ADRs"],
  ["rfcs", "RFCs"],
  ["terms", "glossary terms"],
];

/** Summarise the catalog facts written by a project's selected extractors. */
export function summarizeProjectTrial(snapshot, plan, events) {
  const stepOutputs = new Set(plan.steps.map((step) => step.out));
  const steps = events
    .filter((event) => event.type === "step-finished" && event.phase === "extract" && stepOutputs.has(event.output) && plan.plugins.includes(event.plugin))
    .map((event) => ({
      plugin: event.plugin,
      status: event.status,
      durationMs: event.durationMs,
      fileCount: event.fileCount,
      changedCount: event.changedCount,
      warnings: event.warnings ?? [],
      diagnostics: event.diagnostics ?? [],
      ...(event.message ? { message: event.message } : {}),
    }));
  const facts = new Map(TRIAL_FACTS.map(([key]) => [key, new Set()]));
  const add = (key, id) => { if (id !== undefined && id !== null && String(id)) facts.get(key)?.add(String(id)); };
  const visitService = (service, contextId = "") => {
    const serviceId = service.id ?? `${contextId}/${service.slug ?? service.name ?? "service"}`;
    add("services", serviceId);
    for (const contract of service.provides ?? []) {
      const contractId = `${serviceId}/${contract.id ?? contract.name ?? "contract"}`;
      add("contracts", contractId);
      for (const method of contract.methods ?? []) add("apiOperations", `${contractId}/${method.name ?? method.id}`);
    }
    for (const integration of service.consumes ?? []) add("integrations", `${serviceId}/${integration.id ?? integration.peer ?? JSON.stringify(integration)}`);
    for (const aggregate of service.aggregates ?? []) {
      add("aggregates", aggregate.id ?? `${serviceId}/${aggregate.slug ?? aggregate.name}`);
      for (const entity of aggregate.entities ?? []) add("entities", entity.id ?? `${serviceId}/${entity.name}`);
      for (const event of aggregate.events ?? []) add("events", event.id ?? `${serviceId}/${event.name}`);
      for (const operation of aggregate.operations ?? []) add("domainOperations", `${serviceId}/${aggregate.id ?? "aggregate"}/${operation.name ?? operation.id}`);
    }
    for (const channel of service.channels ?? []) {
      const channelId = `${serviceId}/${channel.address ?? channel.name ?? "channel"}`;
      add("channels", channelId);
      for (const message of channel.messages ?? []) add("messages", `${channelId}/${message.name ?? message.id}`);
    }
  };
  const files = [...new Set(events
    .filter((event) => event.type === "step-finished" && event.phase === "extract" && stepOutputs.has(event.output) && plan.plugins.includes(event.plugin))
    .flatMap((event) => event.files ?? []))];
  for (const name of files) {
    let fragment;
    try { fragment = JSON.parse(readFileSync(join(snapshot, name), "utf8")); } catch { continue; }
    for (const context of fragment.contexts ?? []) {
      const contextId = context.id ?? context.slug ?? context.name;
      add("contexts", contextId);
      for (const service of context.services ?? []) visitService(service, contextId);
    }
    for (const store of fragment.stores ?? []) {
      const storeId = store.id ?? store.slug ?? store.name;
      add("stores", storeId);
      for (const table of store.tables ?? []) add("tables", `${storeId}/${table.id ?? table.name}`);
      for (const pattern of store.keyspaces ?? store.keyPatterns ?? store.keys ?? []) add("keyPatterns", `${storeId}/${pattern.id ?? pattern.pattern ?? pattern.name ?? JSON.stringify(pattern)}`);
    }
    for (const flow of fragment.flows ?? []) add("flows", flow.id ?? flow.slug ?? flow.name);
    for (const adr of fragment.adrs ?? []) add("adrs", adr.id ?? adr.slug ?? adr.title);
    for (const rfc of fragment.rfcs ?? []) add("rfcs", rfc.id ?? rfc.slug ?? rfc.title);
    for (const term of fragment.terms ?? []) add("terms", term.id ?? term.slug ?? term.name);
  }
  const warnings = steps.flatMap((step) => step.warnings.map((message) => ({ plugin: step.plugin, message })));
  const diagnostics = steps.flatMap((step) => step.diagnostics);
  return {
    steps,
    facts: TRIAL_FACTS.map(([key, label]) => ({ key, label, count: facts.get(key)?.size ?? 0 })).filter((fact) => fact.count > 0),
    warnings,
    diagnostics,
    generatedFiles: files.length,
  };
}

export function prepareProjectTrial(workspace, request) {
  const manifest = readManifest(join(workspace, "portolan.json"));
  const { plan } = projectRequestPlan(workspace, manifest, request);
  const fingerprint = workspaceFingerprint(workspace);
  const snapshot = snapshotWorkspace(workspace);
  if (workspaceFingerprint(workspace) !== fingerprint) {
    rmSync(snapshot.holder, { recursive: true, force: true });
    throw new Error("Files changed while the trial workspace was being created. Try again.");
  }
  writeManifest(join(snapshot.snapshot, "portolan.json"), manifestWithProject(manifest, plan, { isolated: true }));
  return { ...snapshot, fingerprint, plan };
}

/**
 * A recording uploaded from the page, staged where the verifier will read it
 * - the project's recordings directory, in a snapshot of the workspace - with
 * the verify step that reads it, added to the snapshot's manifest when the
 * project has none. The workspace itself is not touched until the trial is
 * applied.
 */
export function prepareTraceTrial(workspace, { projectId, name, content }) {
  const manifest = readManifest(join(workspace, "portolan.json"));
  const project = (manifest.projects ?? []).find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Project "${projectId}" does not exist. Add the project before recording it.`);
  const known = builtinPluginNames().has("otel") || (manifest.plugins ?? []).some((plugin) => plugin.name === "otel");
  if (!known) throw new Error("The otel verifier is not available in this installation.");
  const { batches, spans } = checkRecording(content);
  const recording = recordingPath(name, { taken: (candidate) => lstatExists(join(workspace, project.root, candidate)) });
  const fingerprint = workspaceFingerprint(workspace);
  const snapshot = snapshotWorkspace(workspace);
  if (workspaceFingerprint(workspace) !== fingerprint) {
    rmSync(snapshot.holder, { recursive: true, force: true });
    throw new Error("Files changed while the trial workspace was being created. Try again.");
  }
  const target = join(snapshot.snapshot, project.root, recording);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  const next = manifestWithTraceStep(manifest, project);
  if (next.changed) writeManifest(join(snapshot.snapshot, "portolan.json"), next.manifest);
  const trace = { projectId, root: project.root, recording, step: next.step, stepAdded: next.changed, stepChange: next.change, batches, spans, content };
  return { ...snapshot, fingerprint, trace };
}

/**
 * The recording written beside the project, and the manifest with the step
 * that reads it and the names the page mapped. Undoable the way a project
 * is: the manifest before is remembered for a while.
 */
export function applyTraceTrial(workspace, trial, { services, events, routes } = {}) {
  const manifestPath = join(workspace, "portolan.json");
  const before = readFileSync(manifestPath, "utf8");
  const manifest = readManifestText(before, manifestPath);
  const project = (manifest.projects ?? []).find((candidate) => candidate.id === trial.trace.projectId);
  if (!project) throw new Error(`Project "${trial.trace.projectId}" no longer exists.`);
  const target = join(workspace, project.root, trial.trace.recording);
  if (lstatExists(target)) throw new Error(`${posix.join(project.root, trial.trace.recording)} appeared while the trial ran. Run it again.`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, trial.trace.content, { flag: "wx" });
  const next = manifestWithTraceStep(manifest, project);
  const found = traceStepFor(next.manifest, project);
  const mapped = stepWithMappings(found.step, { services, events, routes });
  const changed = next.changed || JSON.stringify(mapped) !== JSON.stringify(found.step);
  let undoToken = null;
  if (changed) {
    const verify = [...next.manifest.verify];
    verify[found.index] = mapped;
    writeManifest(manifestPath, { ...next.manifest, verify });
    undoToken = rememberManifestUndo(workspace, before, readFileSync(manifestPath, "utf8"));
  }
  return { recording: posix.join(project.root, trial.trace.recording), project: project.id, stepAdded: next.changed, manifestChanged: changed, undoToken };
}

function freeLocalPort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForPreview(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.previewError) throw child.previewError;
    if (child.exitCode !== null) throw new Error("The preview server stopped before it became ready.");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("The preview server did not become ready in time.");
}

export function disposeProjectTrial(job) {
  if (job.previewTimer) { clearTimeout(job.previewTimer); job.previewTimer = null; }
  if (job.previewChild?.exitCode === null) job.previewChild.kill("SIGTERM");
  job.previewChild = null;
  job.previewUrl = null;
  if (job.snapshotHolder && lstatExists(job.snapshotHolder)) rmSync(job.snapshotHolder, { recursive: true, force: true });
  job.snapshotHolder = null;
  job.runRoot = null;
}

export async function startProjectPreview(job) {
  const port = await freeLocalPort();
  const origin = `http://127.0.0.1:${port}`;
  const cli = process.env.PORTOLAN_CLI;
  const command = cli ? process.execPath : join(job.runRoot, "node_modules/vite/bin/vite.js");
  const args = cli
    ? [cli, "dev", "--cwd", job.runRoot, "--host", "127.0.0.1", "--port", String(port)]
    : ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const child = spawn(command, args, {
    cwd: job.runRoot,
    env: { ...process.env, PORTOLAN_PROJECT_PREVIEW: "1", ...(cli ? { PORTOLAN_CLI: cli } : {}) },
    stdio: "ignore",
  });
  child.once("error", (error) => { child.previewError = error; });
  job.previewChild = child;
  await waitForPreview(origin, child);
  const context = job.projectPlan.project.group ?? job.projectPlan.discovery.defaults.group;
  const component = job.projectPlan.project.components?.[0] ?? job.projectPlan.project.component ?? job.projectPlan.discovery.defaults.component;
  job.previewUrl = `${origin}/c/${encodeURIComponent(context)}/${encodeURIComponent(component)}`;
  job.previewTimer = setTimeout(() => disposeProjectTrial(job), PROJECT_PREVIEW_TTL_MS);
  job.previewTimer.unref();
  return job.previewUrl;
}
