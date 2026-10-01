// What the dev server answers the site with: the local control-plane routes,
// over the modules under local-api/, which this file also re-exports.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, rmSync } from "node:fs";
import { join, posix } from "node:path";

import { readManifest, readManifestText } from "./manifest.mjs";
import { installDeliveryPreset, planDeliveryPreset, publicDeliveryPreset } from "./delivery-presets.mjs";
import { taskTrackerState, saveTaskTrackerSettings, taskTrackerFullScanTarget } from "./task-tracker-settings.mjs";
import { requestWorkItemsFullScan } from "./work-items-scans.mjs";
import { gitFetchState, saveGitFetchSettings, checkGitAccess } from "./git-fetch-settings.mjs";
import { listGitRefs } from "./git-refs.mjs";
import { deleteDraft, discardDraft, draftPath, fetchClone, listBranches, listDrafts, readDrafts, readPending, restoreDraft, saveDraft } from "./branch-drafts.mjs";
import { eventBridgeState, saveEventBridgeSettings } from "./eventbridge-settings.mjs";
import { annotationState, saveAnnotation } from "./annotations.mjs";
import { UPLOAD_LIMIT } from "./trace-trials.mjs";
import { discoverProject, readLocalSource } from "./local-discovery.mjs";
import { LocalApiError, forgetRepositoryCredential, prepareRepository, storeRepositoryCredential } from "./local-api/repositories.mjs";
import { adrProjectsState, createProjectAdr, updateProjectAdr } from "./local-api/adrs.mjs";
import { djangoAggregateProposals, problemRulesState, saveDjangoAggregates, saveProblemRules, writeManifest } from "./local-api/manifest-file.mjs";
import { projectRequestPlan, removeProject, undoProjectRemoval, writeProject } from "./local-api/projects.mjs";
import { workspaceFingerprint } from "./local-api/workspace.mjs";
import { applyTraceTrial, disposeProjectTrial, prepareTraceTrial } from "./local-api/trials.mjs";
import { jobs, startDraftJob, startJob, startProjectTrial } from "./local-api/runs.mjs";
import { body, localRequest, rawBody, send } from "./local-api/http.mjs";

export { discoverProject, readLocalSource } from "./local-discovery.mjs";
export { classifyRepositoryFailure, externalProjectDefaults, forgetRepositoryCredential, inspectionRoot, prepareRepository, resolveRepositoryCommit, storeRepositoryCredential } from "./local-api/repositories.mjs";
export { adrProjectsState, createProjectAdr, updateProjectAdr } from "./local-api/adrs.mjs";
export { djangoAggregateProposals, problemRulesState, saveDjangoAggregates, saveProblemRules, writeManifest } from "./local-api/manifest-file.mjs";
export { manifestWithProject, manifestWithoutProject, mergeRepos, planProject, removeProject, starterManifestProject, undoProjectRemoval, writeProject } from "./local-api/projects.mjs";
export { diffGeneratedFiles, workspaceFingerprint } from "./local-api/workspace.mjs";
export { summarizeProjectTrial } from "./local-api/trials.mjs";
export { GENERATOR_EVENT_PREFIX } from "./local-api/runs.mjs";

export const LOCAL_API_PREFIX = "/__portolan";

/** Remove Vite's configured base before matching a local control-plane route. */
export function localApiPath(pathname, base = "/") {
  const root = base.endsWith("/") ? base : `${base}/`;
  if (root !== "/" && pathname.startsWith(root)) {
    return `/${pathname.slice(root.length)}`;
  }
  return pathname;
}

function setup(workspace, publicSetupFrom) {
  const manifestPath = join(workspace, "portolan.json");
  const manifestText = readFileSync(manifestPath, "utf8");
  let report;
  try { report = JSON.parse(readFileSync(join(workspace, ".portolan/build-report.json"), "utf8")); } catch {}
  return publicSetupFrom(readManifestText(manifestText, manifestPath), report, createHash("sha256").update(manifestText).digest("hex"));
}

export function localApiPlugin(workspace = process.cwd(), publicSetupFrom) {
  return {
    name: "portolan-local-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        url.pathname = localApiPath(url.pathname, server.config.base);
        if (!url.pathname.startsWith(LOCAL_API_PREFIX)) return next();
        if (!localRequest(req)) return send(res, 403, { error: "The local API is available only through localhost." });
        try {
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/status`) {
            const active = [...jobs.values()].find((job) => job.status === "running");
            return send(res, 200, { local: true, workspace: realpathSync(workspace), setup: setup(workspace, publicSetupFrom), activeRun: active ? { id: active.id, mode: active.mode } : null });
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/adrs/projects`) {
            return send(res, 200, adrProjectsState(workspace));
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/django-aggregates`) {
            return send(res, 200, djangoAggregateProposals(workspace));
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/drafts`) {
            return send(res, 200, { drafts: listDrafts(workspace), ...(url.searchParams.get("files") === "1" ? { files: readDrafts(workspace) } : {}) });
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/drafts/pending`) {
            const draft = readPending(workspace, { project: url.searchParams.get("project") ?? "", branch: url.searchParams.get("branch") ?? "" });
            return draft ? send(res, 200, draft) : send(res, 404, { error: "No generated draft waits here." });
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/drafts/branches`) {
            return send(res, 200, listBranches(workspace, readManifest(join(workspace, "portolan.json"))));
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/rules`) {
            return send(res, 200, problemRulesState(workspace));
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/task-trackers`) {
            return send(res, 200, taskTrackerState(workspace));
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/git-fetch`) return send(res, 200, gitFetchState(workspace));
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/eventbridge`) {
            return send(res, 200, eventBridgeState(workspace));
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/annotations`) {
            return send(res, 200, annotationState(workspace, url.searchParams.get("catalog"), { kind: url.searchParams.get("kind"), id: url.searchParams.get("id") }));
          }
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/delivery-presets`) {
            const features = url.searchParams.has("features")
              ? url.searchParams.get("features").split(",").filter(Boolean)
              : undefined;
            return send(res, 200, publicDeliveryPreset(planDeliveryPreset(workspace, {
              provider: url.searchParams.get("provider") || undefined,
              features,
            })));
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
          if (req.method === "POST" && url.pathname === `${LOCAL_API_PREFIX}/traces/trials` && req.headers["x-portolan-local"] === "1") {
            // The one upload the local API takes: a recording, as bytes,
            // named by headers rather than wrapped in JSON.
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const content = await rawBody(req, UPLOAD_LIMIT);
            const projectId = String(req.headers["x-portolan-project"] ?? "");
            const name = decodeURIComponent(String(req.headers["x-portolan-filename"] ?? "recording.jsonl"));
            const prepared = prepareTraceTrial(workspace, { projectId, name, content });
            let job;
            try { job = startJob(workspace, "trace-preview", null, prepared); }
            catch (cause) { rmSync(prepared.holder, { recursive: true, force: true }); throw cause; }
            return send(res, 202, { runId: job.id, mode: job.mode, recording: posix.join(prepared.trace.root, prepared.trace.recording), project: projectId, stepAdded: prepared.trace.stepAdded, stepChange: prepared.trace.stepChange, spans: prepared.trace.spans });
          }
          if (req.method !== "POST" || req.headers["content-type"]?.split(";")[0] !== "application/json" || req.headers["x-portolan-local"] !== "1") {
            return send(res, 405, { error: "Use a local JSON request." });
          }
          const input = await body(req);
          if (url.pathname === `${LOCAL_API_PREFIX}/annotations`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "Wait for the current generation to finish before saving properties." });
            const saved = saveAnnotation(workspace, input);
            try {
              const job = startJob(workspace, "write", null);
              return send(res, 200, { ...saved, run: { runId: job.id } });
            } catch (cause) {
              return send(res, 200, { ...saved, run: null, generationError: cause instanceof Error ? cause.message : String(cause) });
            }
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/drafts/generate`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "Wait for the current run to finish before generating a draft." });
            const job = startDraftJob(workspace, { project: String(input.project ?? ""), branch: String(input.branch ?? "") });
            return send(res, 202, { runId: job.id, mode: job.mode, path: job.draft.path });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/drafts/delete`) {
            if ([...jobs.values()].some((job) => job.status === "running" && job.mode === "draft" && job.draft.project === input.project && job.draft.branch === input.branch)) {
              return send(res, 409, { error: "That draft is being generated; cancel the run first." });
            }
            const project = String(input.project ?? "");
            const branch = String(input.branch ?? "");
            return send(res, 200, { deleted: deleteDraft(workspace, { project, branch }), path: draftPath(project, branch) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/drafts/fetch`) {
            // The one place dev touches a network for drafts, and only when a
            // reader asks: fetch the project's clone, then say where its
            // branches are now.
            const fetched = fetchClone(workspace, { project: String(input.project ?? "") });
            return send(res, 200, { ...fetched, drafts: listDrafts(workspace) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/drafts/restore`) {
            return send(res, 200, { path: restoreDraft(workspace, { project: String(input.project ?? ""), branch: String(input.branch ?? "") }) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/drafts/save`) {
            return send(res, 200, { path: saveDraft(workspace, { project: String(input.project ?? ""), branch: String(input.branch ?? "") }) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/drafts/discard`) {
            return send(res, 200, { discarded: discardDraft(workspace, { project: String(input.project ?? ""), branch: String(input.branch ?? "") }) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/git-fetch/refs`) {
            return send(res, 200, await listGitRefs(input.repository));
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/git-fetch/check-access`) {
            return send(res, 200, await checkGitAccess(input.repository));
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/git-fetch`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "Wait for the current generation to finish before saving Git sources." });
            const saved = saveGitFetchSettings(workspace, input, writeManifest);
            if (!input.generate) return send(res, 200, { ...saved, run: null });
            try {
              const job = startJob(workspace, "write", null);
              return send(res, 200, { ...saved, run: { runId: job.id } });
            } catch (cause) {
              return send(res, 200, { ...saved, run: null, generationError: cause instanceof Error ? cause.message : String(cause) });
            }
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/task-trackers/full-scan`) {
            // Task links are read from the history, not generated (portolan.0020):
            // a full scan is a reading without the commit limit, and the pages
            // reload with it. Nothing runs and nothing is written.
            requestWorkItemsFullScan(taskTrackerFullScanTarget(workspace, input));
            return send(res, 200, { runId: null });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/task-trackers`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "Wait for the current generation to finish before saving trackers." });
            const saved = saveTaskTrackerSettings(workspace, input, writeManifest);
            if (!input.generate) return send(res, 200, { ...saved, run: null });
            try {
              const entry = saved.entries.find((entry) => entry.input === input.input);
              if (input.fullScan === true) requestWorkItemsFullScan(taskTrackerFullScanTarget(workspace, { revision: saved.revision, step: entry?.step }));
              const job = startJob(workspace, "write", null);
              return send(res, 200, { ...saved, run: { runId: job.id, mode: job.mode } });
            } catch (cause) {
              return send(res, 200, { ...saved, run: null, generationError: cause instanceof Error ? cause.message : String(cause) });
            }
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/eventbridge`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "Wait for the current generation to finish before saving EventBridge settings." });
            const saved = saveEventBridgeSettings(workspace, input, writeManifest);
            if (!input.generate) return send(res, 200, { ...saved, run: null });
            try {
              const job = startJob(workspace, "write", null);
              return send(res, 200, { ...saved, run: { runId: job.id, mode: job.mode } });
            } catch (cause) {
              return send(res, 200, { ...saved, run: null, generationError: cause instanceof Error ? cause.message : String(cause) });
            }
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/django-aggregates`) {
            if ([...jobs.values()].some((job) => job.status === "running")) throw new Error("Wait for the current generation to finish before saving aggregate roots.");
            return send(res, 200, saveDjangoAggregates(workspace, input));
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/rules`) {
            if ([...jobs.values()].some((job) => job.status === "running")) throw new Error("Wait for the current generation to finish before saving rules.");
            return send(res, 200, saveProblemRules(workspace, input));
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/adrs`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "Wait for the current generation to finish before writing an ADR." });
            const created = createProjectAdr(workspace, input);
            try {
              const job = startJob(workspace, "write", null);
              return send(res, 201, { ...created, run: { runId: job.id, mode: job.mode } });
            } catch (cause) {
              return send(res, 201, { ...created, run: null, generationError: cause instanceof Error ? cause.message : String(cause) });
            }
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/adrs/update`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "Wait for the current generation to finish before updating an ADR." });
            const updated = updateProjectAdr(workspace, input);
            try {
              const job = startJob(workspace, "write", null);
              return send(res, 200, { ...updated, run: { runId: job.id, mode: job.mode } });
            } catch (cause) {
              return send(res, 200, { ...updated, run: null, generationError: cause instanceof Error ? cause.message : String(cause) });
            }
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/delivery-presets/install`) {
            return send(res, 201, installDeliveryPreset(workspace, input));
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/source`) return send(res, 200, readLocalSource(workspace, input.path));
          if (url.pathname === `${LOCAL_API_PREFIX}/repositories/credentials`) return send(res, 201, storeRepositoryCredential(input));
          if (url.pathname === `${LOCAL_API_PREFIX}/repositories/credentials/forget`) return send(res, 200, forgetRepositoryCredential(input));
          if (url.pathname === `${LOCAL_API_PREFIX}/repositories/prepare`) return send(res, 200, prepareRepository(workspace, input));
          if (url.pathname === `${LOCAL_API_PREFIX}/discover`) return send(res, 200, discoverProject(workspace, input.path));
          if (url.pathname === `${LOCAL_API_PREFIX}/projects/trials`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const job = startProjectTrial(workspace, input);
            return send(res, 202, { runId: job.id, mode: job.mode, plan: job.projectPlan });
          }
          const applyTrialMatch = url.pathname.match(/^\/__portolan\/projects\/trials\/([^/]+)\/apply$/);
          if (applyTrialMatch) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const trial = jobs.get(applyTrialMatch[1]);
            if (!trial?.projectRequest || !trial.trial || trial.status !== "ok") return send(res, 409, { error: "Run a successful project trial before adding it." });
            if (trial.applied) return send(res, 409, { error: "This project trial was already applied." });
            if (workspaceFingerprint(workspace) !== trial.fingerprint) return send(res, 409, { error: "Files changed after this project trial. Run it again." });
            disposeProjectTrial(trial);
            const result = writeProject(workspace, trial.projectRequest);
            trial.applied = true;
            const generation = input.generate ? startJob(workspace, "write", trial) : null;
            return send(res, 201, { ...result, setup: setup(workspace, publicSetupFrom), run: generation ? { runId: generation.id, mode: generation.mode } : null });
          }
          const disposeTrialMatch = url.pathname.match(/^\/__portolan\/projects\/trials\/([^/]+)\/dispose$/);
          if (disposeTrialMatch) {
            const trial = jobs.get(disposeTrialMatch[1]);
            if (!trial?.projectRequest) return send(res, 404, { error: "Project trial not found." });
            if (trial.status === "running") return send(res, 409, { error: "Cancel the running project trial first." });
            disposeProjectTrial(trial);
            return send(res, 200, { runId: trial.id, status: "disposed" });
          }
          const applyTraceMatch = url.pathname.match(/^\/__portolan\/traces\/trials\/([^/]+)\/apply$/);
          if (applyTraceMatch) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const trial = jobs.get(applyTraceMatch[1]);
            if (!trial?.trace || trial.status !== "ok" || !trial.traceTrial) return send(res, 409, { error: "Run a successful recording trial before keeping it." });
            if (trial.applied) return send(res, 409, { error: "This recording was already kept." });
            if (workspaceFingerprint(workspace) !== trial.fingerprint) return send(res, 409, { error: "Files changed after this trial. Upload the recording again." });
            const result = applyTraceTrial(workspace, trial, { services: input.services, events: input.events, routes: input.routes });
            trial.applied = true;
            const generation = input.generate ? startJob(workspace, "write", trial) : null;
            return send(res, 201, { ...result, setup: setup(workspace, publicSetupFrom), run: generation ? { runId: generation.id, mode: generation.mode } : null });
          }
          const disposeTraceMatch = url.pathname.match(/^\/__portolan\/traces\/trials\/([^/]+)\/dispose$/);
          if (disposeTraceMatch) {
            const trial = jobs.get(disposeTraceMatch[1]);
            if (!trial?.trace) return send(res, 404, { error: "Recording trial not found." });
            if (trial.status === "running") return send(res, 409, { error: "Cancel the running trial first." });
            trial.trace.content = null;
            disposeProjectTrial(trial);
            return send(res, 200, { runId: trial.id, status: "disposed" });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/projects/preview`) {
            const manifest = readManifest(join(workspace, "portolan.json"));
            return send(res, 200, projectRequestPlan(workspace, manifest, input).plan);
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/projects`) {
            const result = writeProject(workspace, input);
            return send(res, 201, { ...result, setup: setup(workspace, publicSetupFrom) });
          }
          const removeProjectMatch = url.pathname.match(/^\/__portolan\/projects\/([^/]+)\/remove$/);
          if (removeProjectMatch) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const result = removeProject(workspace, decodeURIComponent(removeProjectMatch[1]));
            return send(res, 200, { ...result, setup: setup(workspace, publicSetupFrom) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/projects/removals/undo`) {
            const result = undoProjectRemoval(workspace, input.undoToken);
            return send(res, 200, { ...result, setup: setup(workspace, publicSetupFrom) });
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
          const status = error instanceof LocalApiError ? error.status : Number.isInteger(error?.status) ? error.status : 400;
          return send(res, status, {
            error: error instanceof Error ? error.message : String(error),
            ...(error instanceof LocalApiError ? {
              code: error.code,
              retryable: error.retryable,
              provider: error.provider,
              host: error.host,
              credentialSupported: error.credentialSupported,
              credentialPresent: error.credentialPresent,
            } : {}),
          });
        }
      });
    },
  };
}
