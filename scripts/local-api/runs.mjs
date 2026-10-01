// Generator runs: one at a time, streamed to the page as events, cancellable;
// a project trial, a recording trial and a branch draft are runs too.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { pluginsFresh } from "../plugins-fresh.mjs";
import { draftPath } from "../branch-drafts.mjs";
import { bundlePath, likec4Projects, likec4ReactArgs } from "../likec4-bundle.mjs";
import { summarizeTraceTrial } from "../trace-trials.mjs";
import { gitAuthEnvironment } from "./repositories.mjs";
import { diffGeneratedFiles, lstatExists, snapshotWorkspace, workspaceFingerprint } from "./workspace.mjs";
import { disposeProjectTrial, prepareProjectTrial, startProjectPreview, summarizeProjectTrial } from "./trials.mjs";

export const GENERATOR_EVENT_PREFIX = "::portolan-event::";

export const jobs = new Map();

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

/**
 * Rebuilds the bundle of every project under likec4/ in the workspace - one
 * per profile (portolan.0034) - the way `npm run likec4:gen` does before
 * `dev`. Said in the run's log either way; a bundle that fails to build leaves
 * the last one in place.
 */
async function refreshLikeC4Bundle(job) {
  const bin = join(job.runRoot, "node_modules/likec4/bin/likec4.mjs");
  if (!lstatExists(bin)) return;
  for (const project of likec4Projects(job.runRoot)) {
    await new Promise((done) => {
      emit(job, { type: "log", stream: "stdout", message: `likec4 → ${bundlePath(project)}` });
      const child = spawn(process.execPath, [bin, ...likec4ReactArgs(project)], { cwd: job.runRoot, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.on("error", (error) => { emit(job, { type: "log", stream: "stderr", message: `likec4: ${error.message}` }); done(); });
      child.on("close", (code) => {
        if (code !== 0) emit(job, { type: "log", stream: "stderr", message: `likec4 gen react exited with ${code}:\n${output.trim()}` });
        done();
      });
    });
  }
}

export function startJob(workspace, mode, approvedPreview, preparedTrial) {
  const id = randomUUID();
  const preview = mode === "preview" || mode === "project-preview" || mode === "trace-preview";
  const fingerprint = preparedTrial?.fingerprint ?? (preview ? workspaceFingerprint(workspace) : approvedPreview?.fingerprint);
  const snapshot = preparedTrial ?? (preview ? snapshotWorkspace(workspace) : null);
  if (preview && !preparedTrial && workspaceFingerprint(workspace) !== fingerprint) {
    rmSync(snapshot.holder, { recursive: true, force: true });
    throw new Error("Files changed while the preview workspace was being created. Try again.");
  }
  const generatedAt = preview ? new Date().toISOString() : approvedPreview?.generatedAt;
  const gitAuth = gitAuthEnvironment();
  const job = { id, mode, status: "running", events: [], subscribers: new Set(), buffers: { stdout: "", stderr: "" }, child: null, gitAuth, runRoot: snapshot?.snapshot ?? workspace, snapshotHolder: snapshot?.holder ?? null, fingerprint, generatedAt, projectPlan: preparedTrial?.plan ?? null, projectRequest: preparedTrial?.request ? structuredClone(preparedTrial.request) : null, trace: preparedTrial?.trace ?? null };
  jobs.set(id, job);
  const cli = process.env.PORTOLAN_CLI;
  // `npm run gen` builds the plugins first, which a checkout whose plugin
  // sources have not moved since the last build does not need: the fourth
  // trial of a recording in a row learns nothing from a minute of javac.
  // When every artefact is at least as new as its sources the generator
  // runs on its own; anything doubtful takes the road that builds.
  const fresh = !cli && pluginsFresh(job.runRoot);
  const command = cli || fresh ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = cli
    ? [cli, mode === "check" ? "check" : "generate", "--cwd", job.runRoot]
    : fresh
      ? [join(job.runRoot, "scripts/gen.mjs"), ...(mode === "check" ? ["--check"] : [])]
      : ["run", mode === "check" ? "gen:check" : "gen"];
  let child;
  try {
    child = spawn(command, args, {
      cwd: job.runRoot,
      env: { ...gitAuth.env, PORTOLAN_EVENTS: "1", ...(generatedAt ? { PORTOLAN_GENERATED_AT: generatedAt } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
  } catch (cause) {
    gitAuth.dispose();
    jobs.delete(id);
    throw cause;
  }
  job.child = child;
  emit(job, { type: "run-started", runId: id, mode });
  child.stdout.on("data", (chunk) => feed(job, "stdout", chunk));
  child.stderr.on("data", (chunk) => feed(job, "stderr", chunk));
  child.on("error", (error) => emit(job, { type: "run-finished", status: "failed", message: error.message }));
  child.on("close", async (code, signal) => {
    job.gitAuth.dispose();
    job.gitAuth = null;
    for (const stream of ["stdout", "stderr"]) if (job.buffers[stream]) emit(job, { type: "log", stream, message: job.buffers[stream] });
    job.status = signal ? "cancelled" : code === 0 ? "ok" : "failed";
    if (preview && job.status !== "cancelled") {
      try { job.preview = diffGeneratedFiles(workspace, job.runRoot, job.events); emit(job, { type: "preview-ready", ...job.preview }); }
      catch (cause) { job.status = "failed"; emit(job, { type: "log", stream: "stderr", message: `Could not build preview: ${cause instanceof Error ? cause.message : String(cause)}` }); }
    }
    if (mode === "project-preview" && job.status === "ok") {
      try {
        job.trial = summarizeProjectTrial(job.runRoot, job.projectPlan, job.events);
        try { job.trial.previewUrl = await startProjectPreview(job); }
        catch (cause) { job.trial.previewError = cause instanceof Error ? cause.message : String(cause); }
        emit(job, { type: "project-trial-ready", plan: job.projectPlan, ...job.trial });
      }
      catch (cause) { job.status = "failed"; emit(job, { type: "log", stream: "stderr", message: `Could not summarise project trial: ${cause instanceof Error ? cause.message : String(cause)}` }); }
    }
    if (mode === "trace-preview" && job.status === "ok") {
      try {
        job.traceTrial = summarizeTraceTrial(job.runRoot, job.trace, job.events);
        emit(job, { type: "trace-trial-ready", ...job.traceTrial });
      }
      catch (cause) { job.status = "failed"; emit(job, { type: "log", stream: "stderr", message: `Could not summarise the recording: ${cause instanceof Error ? cause.message : String(cause)}` }); }
    }
    // The catalog is written, and the pictures' sources with it; the bundle
    // the dev server draws them from is built once before it starts, so a
    // write from the page rebuilds it here, or the new flow has no picture
    // until the next start.
    if (mode === "write" && job.status === "ok" && !process.env.PORTOLAN_CLI) await refreshLikeC4Bundle(job);
    emit(job, { type: "process-finished", status: job.status, code, signal });
    for (const response of job.subscribers) response.end();
    job.subscribers.clear();
    if (job.snapshotHolder && !(mode === "project-preview" && job.status === "ok" && job.previewUrl)) disposeProjectTrial(job);
  });
  return job;
}

// Generating a draft (portolan.0019) is a run like gen's: one at a time,
// streamed to the page, cancellable. It writes one file under portolan-drafts/
// and nothing else in the workspace; the worktrees it reads live in a
// temporary directory.
const BRANCH_DRAFTS = join(dirname(fileURLToPath(import.meta.url)), "..", "branch-drafts.mjs");

export function startDraftJob(workspace, { project, branch }) {
  const path = draftPath(project, branch);
  const id = randomUUID();
  const job = { id, mode: "draft", status: "running", events: [], subscribers: new Set(), buffers: { stdout: "", stderr: "" }, child: null, runRoot: workspace, snapshotHolder: null, draft: { project, branch, path } };
  jobs.set(id, job);
  let child;
  try {
    child = spawn(process.execPath, [BRANCH_DRAFTS, "generate", "--pending", "--project", project, "--branch", branch], {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
  } catch (cause) {
    jobs.delete(id);
    throw cause;
  }
  job.child = child;
  emit(job, { type: "run-started", runId: id, mode: job.mode, project, branch });
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

export function startProjectTrial(workspace, request) {
  const prepared = prepareProjectTrial(workspace, request);
  prepared.request = request;
  try { return startJob(workspace, "project-preview", null, prepared); }
  catch (cause) { rmSync(prepared.holder, { recursive: true, force: true }); throw cause; }
}
