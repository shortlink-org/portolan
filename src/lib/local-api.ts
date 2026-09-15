import type { SetupDiagnostic, SetupInfo, SetupPhase, SetupProject, SetupRunStepStatus } from "./setup-info";
import type { DjangoAggregateCandidates } from "./django-aggregates";
import type { ProblemRuleEntry } from "./problem-rules";
import type { TaskTrackerEntry, TaskTracker } from "./task-tracker-config.mjs";
import type { GitFetchRepo } from "./git-fetch-config.mjs";

export interface GitFetchEntry { step: number; plugin: string; output: string; repos: GitFetchRepo[]; catalogs: string[]; error?: string }
export interface GitFetchState { revision: string; workspaceKey: string; entries: GitFetchEntry[]; remotes: Array<{ repo: string; source: string; catalogs: string[] }>; catalogRepositories: Array<{ repo: string; source: string; catalogs: string[] }>; discoveryWarnings: string[]; catalogs: Array<{ id: string; title: string }> }
export interface GitAccessResult { status: "accessible" | "unavailable"; message: string }
export interface GitRemoteRef { ref: string; name: string; kind: "branch" | "tag" }
export interface GitRefsResult { refs: GitRemoteRef[]; truncated: boolean }
export function gitRepositoryRefs(repository: string): Promise<GitRefsResult> { return json("/git-fetch/refs", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ repository }) }); }
export function checkGitRepositoryAccess(repository: string): Promise<GitAccessResult> { return json("/git-fetch/check-access", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ repository }) }); }
export interface SaveGitFetch { revision: string; step: number | null; output: string; repos: GitFetchRepo[]; catalog: string | null; generate: boolean }
export function gitFetchSettings(): Promise<GitFetchState> { return json("/git-fetch"); }
export function saveGitFetch(request: SaveGitFetch): Promise<GitFetchState & { run: { runId: string } | null; generationError?: string }> { return json("/git-fetch", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(request) }); }

export interface TaskTrackerState {
  revision: string;
  entries: Array<TaskTrackerEntry & { managed: boolean; catalogs: string[] }>;
  repositories: Array<{ input: string; label: string; available: boolean; reason?: string; shallow?: boolean }>;
  catalogs: Array<{ id: string; title: string }>;
}
export interface SaveTaskTrackers {
  revision: string;
  step: number | null;
  input: string;
  catalogs: string[];
  trackers: TaskTracker[];
  maxCommits: number;
  generate: boolean;
  fullScan?: boolean;
}
export function taskTrackerSettings(): Promise<TaskTrackerState> {
  return json("/task-trackers");
}
/** Reads the task links again without the commit limit; nothing is generated (portolan.0020). */
export function fullScanTaskTrackers(revision: string, step: number): Promise<{ runId: null }> {
  return json("/task-trackers/full-scan", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ revision, step }) });
}
export function saveTaskTrackers(request: SaveTaskTrackers): Promise<TaskTrackerState & { run: { runId: string } | null; generationError?: string }> {
  return json("/task-trackers", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(request) });
}

export interface EventBridgeEntry {
  step: number;
  input: string;
  output: string;
  cache: string;
  regions: string[];
  buses: string[];
  sources: Record<string, string>;
  targets: Record<string, string>;
  ruleTags?: { context: string; service: string };
  managed: boolean;
  catalogs: string[];
}
export interface EventBridgeState {
  revision: string;
  entries: EventBridgeEntry[];
  catalogs: Array<{ id: string; title: string }>;
}
export interface SaveEventBridge {
  revision: string;
  step: number | null;
  catalogs: string[];
  regions: string[];
  buses: string[];
  sources: Record<string, string>;
  targets: Record<string, string>;
  ruleTags?: { context: string; service: string };
  generate: boolean;
}
export function eventBridgeSettings(): Promise<EventBridgeState> {
  return json("/eventbridge");
}
export function saveEventBridge(request: SaveEventBridge): Promise<EventBridgeState & { run: { runId: string } | null; generationError?: string }> {
  return json("/eventbridge", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(request) });
}

const ROOT = `${import.meta.env.BASE_URL}__portolan`;
const LOCAL_HEADER = { "Content-Type": "application/json", "X-Portolan-Local": "1" };

export interface Detection {
  plugin: string;
  confidence: "high" | "medium";
  evidence: string;
  candidates: string[];
  options: Record<string, unknown>;
  selected: boolean;
  preview?: Array<{ file: string; fields: Record<string, string> }>;
}

export interface Discovery {
  root: string;
  filesScanned: number;
  truncated: boolean;
  components: Array<{ path: string; name: string; markers: string[]; technologies: string[] }>;
  componentsTruncated: boolean;
  deployables: Array<{ slug: string; name: string; path: string; kind: "service"; confidence: "high" | "medium"; evidence: string[] }>;
  defaults: { id: string; name: string; group: string; component: string; context: string; service: string };
  detections: Detection[];
}

export interface ProjectDraft {
  source: "local" | "external";
  root: string;
  repository: string;
  ref: string;
  commit: string;
  sourcePath: string;
  id: string;
  name: string;
  group: string;
  component: string;
  context?: string;
  service?: string;
  contextName?: string;
  contextSummary?: string;
  classification?: "core" | "supporting" | "generic";
  replaceStarter?: boolean;
  groupKind?: "bounded-context" | "system" | "product" | "team" | "namespace";
  componentKind?: "service" | "application" | "webapp" | "worker" | "job" | "function" | "cli" | "library" | "data-pipeline";
  plugins: string[];
}

export interface AnnotationState {
  catalog: string;
  target: import("../catalog").AnnotationTarget;
  path: string;
  revision: string;
  fileRevision: string | null;
  document: import("../catalog").AnnotationDocument;
  writable: boolean;
  reason?: string;
  workspace: string;
}
export interface SavedAnnotation extends AnnotationState {
  run: { runId: string } | null;
  generationError?: string;
}
export function getAnnotation(catalog: string, target: import("../catalog").AnnotationTarget): Promise<AnnotationState> {
  return json(`/annotations?${new URLSearchParams({ catalog, ...target })}`);
}
export function saveAnnotation(input: Pick<AnnotationState, "revision" | "fileRevision" | "document">): Promise<SavedAnnotation> {
  return json("/annotations", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(input) });
}

export interface AdrProject {
  id: string;
  name: string;
  root: string;
  scope: string;
  prefix: string;
  directory: string;
  count: number;
  nextNumber: number;
  files: Array<{ path: string; revision: string }>;
  configured: boolean;
  writable: boolean;
  reason?: string;
}

export interface AdrProjectsState {
  revision: string;
  projects: AdrProject[];
}

export interface CreateAdrInput {
  revision: string;
  projectId: string;
  number: number;
  title: string;
  status: "proposed" | "accepted" | "superseded" | "deprecated" | "rejected";
  date: string;
  body: string;
  note?: string;
  supersededBy?: string;
  supersedes?: string[];
  relates?: { services?: string[]; events?: string[]; flows?: string[] };
}

export interface UpdateAdrInput extends CreateAdrInput {
  path: string;
  fileRevision: string;
}

export interface CreatedAdr {
  id: string;
  slug: string;
  number: number;
  title: string;
  path: string;
  manifestChanged: boolean;
  run: { runId: string; mode: "write" } | null;
  generationError?: string;
}

export interface ProjectPlan {
  project: { id: string; name: string; root: string; group?: string; component?: string; components?: string[]; groupKind?: string; componentKind?: string; context?: string; service?: string; repository?: string };
  plugins: string[];
  steps: Array<{ plugin: string; in: string; out: string; options: Record<string, unknown> }>;
  source: string;
  discovery: Discovery;
  fetch: { repo: string; commit: string; paths: string[] } | null;
}

export interface RepositoryInspection {
  repository: string;
  ref: string;
  commit: string;
  sourcePath: string;
  checkoutRoot: string;
  discovery: Discovery;
}

export interface GeneratedFileDiff {
  path: string;
  status: "added" | "changed" | "removed";
  diff: string;
}

export type DeliveryProvider = "github" | "gitlab";
export type DeliveryFeatureId = "check" | "diff" | "sarif" | "pages";

export interface DeliveryFeature {
  id: DeliveryFeatureId;
  label: string;
  description: string;
  selected: boolean;
  available: boolean;
  requires: DeliveryFeatureId[];
}

export interface DeliveryPresetFile {
  path: string;
  status: "added" | "changed" | "removed" | "unchanged" | "conflict";
  diff: string;
  message?: string;
}

export interface DeliveryPreset {
  provider: DeliveryProvider;
  detectedProvider: DeliveryProvider | null;
  remote: string | null;
  repository: string;
  defaultBranch: string;
  status: "available" | "installed" | "update" | "conflict";
  revision: string;
  features: DeliveryFeature[];
  files: DeliveryPresetFile[];
}

export interface ProjectTrialFact {
  key: string;
  label: string;
  count: number;
}

export interface ProjectTrialStep {
  plugin: string;
  status: SetupRunStepStatus;
  durationMs: number;
  fileCount: number;
  changedCount: number;
  warnings: string[];
  diagnostics: SetupDiagnostic[];
  message?: string;
}

export interface ProjectTrial {
  plan: ProjectPlan;
  steps: ProjectTrialStep[];
  facts: ProjectTrialFact[];
  warnings: Array<{ plugin: string; message: string }>;
  diagnostics: SetupDiagnostic[];
  generatedFiles: number;
  previewUrl?: string;
  previewError?: string;
}

/** One flow the verifier wrote after reading an uploaded recording. */
export interface TraceTrialFlow {
  id: string;
  slug: string;
  name: string;
  owner: string;
  kind: "declared" | "observed";
  /** Whether the uploaded recording itself showed this flow. */
  inRecording: boolean;
  /** Traces in the uploaded recording that showed it. */
  traces: number;
  verified: number;
  unresolved: number;
  /** Hops the recordings showed that the code does not declare. */
  added: number;
  /** Distinct steps the uploaded recording showed. */
  shown: number;
  steps: number;
  examples: number;
}

export interface TraceTrialWarning {
  kind: "service" | "event" | "route" | "call" | "channel" | "other";
  /** The name the verifier could not place, for a service or an event. */
  name?: string;
  message: string;
}

/** What a trial run said about an uploaded recording. */
export interface TraceTrial {
  project: string;
  /** Where the recording lands, relative to the project root. */
  recording: string;
  /** Whether keeping it adds or widens the project's verify step. */
  stepAdded: boolean;
  /** What keeping it does to portolan.json: a new verify step, one more glob on the step it has, or nothing. */
  stepChange: "added" | "widened" | "none";
  status: SetupRunStepStatus;
  spans: number;
  flows: TraceTrialFlow[];
  warnings: TraceTrialWarning[];
  mappings: { services: Record<string, string>; events: Record<string, string>; routes: Record<string, string> };
}

export type RunMode = "write" | "check" | "preview" | "project-preview" | "trace-preview" | "draft";

export type RunEvent =
  | { type: "run-started"; at: string; runId: string; mode: RunMode }
  | { type: "pipeline-ready"; at: string; stepCount: number }
  | { type: "step-started"; at: string; ordinal: number; phase: SetupPhase; plugin: string; input?: string; output: string }
  | { type: "step-finished"; at: string; ordinal: number; phase: SetupPhase; plugin: string; status: SetupRunStepStatus; durationMs: number; fileCount: number; changedCount: number; changes: Array<{ kind: "added" | "changed" | "removed"; path: string }>; files: string[]; warnings?: string[]; diagnostics?: SetupDiagnostic[]; message?: string }
  | { type: "preview-ready"; at: string; files: GeneratedFileDiff[]; totalFiles: number; truncated: boolean }
  | ({ type: "project-trial-ready"; at: string } & ProjectTrial)
  | ({ type: "trace-trial-ready"; at: string } & TraceTrial)
  | { type: "run-finished"; at: string; status: string; durationMs?: number; message?: string }
  | { type: "process-finished"; at: string; status: string; durationMs?: number; message?: string }
  | { type: "draft-progress"; at: string; message: string }
  | { type: "draft-ready"; at: string; project: string; branch: string; path: string; entities: number; views: number; warnings: string[] }
  | { type: "log"; at: string; stream: "stdout" | "stderr"; message: string };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, init);
  const value = await response.json() as T & { error?: string; code?: string; retryable?: boolean; provider?: string; host?: string; credentialSupported?: boolean; credentialPresent?: boolean };
  if (!response.ok) throw new LocalApiError(value.error || `Local API returned ${response.status}.`, {
    status: response.status,
    code: value.code,
    retryable: value.retryable,
    provider: value.provider,
    host: value.host,
    credentialSupported: value.credentialSupported,
    credentialPresent: value.credentialPresent,
  });
  return value;
}

export class LocalApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly host?: string;
  readonly credentialSupported: boolean;
  readonly credentialPresent: boolean;

  constructor(message: string, options: { status: number; code?: string; retryable?: boolean; provider?: string; host?: string; credentialSupported?: boolean; credentialPresent?: boolean }) {
    super(message);
    this.name = "LocalApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
    this.host = options.host;
    this.credentialSupported = options.credentialSupported ?? false;
    this.credentialPresent = options.credentialPresent ?? false;
  }
}

export async function localStatus(): Promise<{ local: true; workspace: string; setup: SetupInfo; activeRun: { id: string; mode: RunMode } | null }> {
  return json("/status");
}

/** Projects and source directories the dev server can write ADRs into. */
export async function adrProjects(): Promise<AdrProjectsState> {
  return json("/adrs/projects");
}

/** Writes an ADR beside its project and starts catalog generation. */
export async function createAdr(input: CreateAdrInput): Promise<CreatedAdr> {
  return json("/adrs", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(input) });
}

/** Rewrites one ADR using optimistic manifest and file revisions, then rebuilds. */
export async function updateAdr(input: UpdateAdrInput): Promise<CreatedAdr> {
  return json("/adrs/update", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(input) });
}

export interface DjangoAggregateProposals {
  revision: string;
  stale: boolean;
  proposals: Array<DjangoAggregateCandidates & { id: string; step: number; plugin: string; input: string; output: string; message: string }>;
}

export async function djangoAggregateProposals(): Promise<DjangoAggregateProposals> {
  return json("/django-aggregates");
}

export async function saveDjangoAggregates(revision: string, selections: Array<{ id: string; model: string }>): Promise<{ saved: number }> {
  return json("/django-aggregates", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ revision, selections }) });
}

/** The manifest's `problemRules`, with a revision a save must quote. */
export interface ProblemRulesState {
  revision: string;
  rules: ProblemRuleEntry[];
}

export async function problemRules(): Promise<ProblemRulesState> {
  return json("/rules");
}

/** Replaces `problemRules` in portolan.json, once the server has type-checked every expression. */
export async function saveProblemRules(revision: string, rules: ProblemRuleEntry[]): Promise<ProblemRulesState> {
  return json("/rules", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ revision, rules }) });
}

export async function previewDeliveryPreset(provider?: DeliveryProvider, features?: DeliveryFeatureId[]): Promise<DeliveryPreset> {
  const query = new URLSearchParams();
  if (provider) query.set("provider", provider);
  if (features) query.set("features", features.join(","));
  return json(`/delivery-presets${query.size ? `?${query}` : ""}`);
}

export async function installDeliveryPreset(provider: DeliveryProvider, revision: string, features: DeliveryFeatureId[]): Promise<DeliveryPreset & { written: string[] }> {
  return json("/delivery-presets/install", {
    method: "POST",
    headers: LOCAL_HEADER,
    body: JSON.stringify({ provider, revision, features }),
  });
}

export async function discover(path: string): Promise<Discovery> {
  return json("/discover", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ path }) });
}

export async function inspectRepository(repository: string, ref: string, sourcePath: string): Promise<RepositoryInspection> {
  return json("/repositories/prepare", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ repository, ref, sourcePath }) });
}

export async function saveRepositoryCredential(repository: string, token: string): Promise<{ host: string; provider: string; scope: "session"; stored: true }> {
  return json("/repositories/credentials", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ repository, token }) });
}

export async function forgetRepositoryCredential(repository: string): Promise<{ host: string; provider: string; scope: "session"; stored: false }> {
  return json("/repositories/credentials/forget", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ repository }) });
}

export async function previewProject(draft: ProjectDraft): Promise<ProjectPlan> {
  return json("/projects/preview", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function addProject(draft: ProjectDraft): Promise<ProjectPlan & { undoToken: string; setup: SetupInfo }> {
  return json("/projects", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function removeProject(id: string): Promise<{ project: SetupProject; removedOutputs: string[]; undoToken: string; setup: SetupInfo }> {
  return json(`/projects/${encodeURIComponent(id)}/remove`, { method: "POST", headers: LOCAL_HEADER, body: "{}" });
}

export async function undoProjectRemoval(undoToken: string): Promise<{ restored: true; setup: SetupInfo }> {
  return json("/projects/removals/undo", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ undoToken }) });
}

export async function startProjectTrial(draft: ProjectDraft): Promise<{ runId: string; mode: "project-preview"; plan: ProjectPlan }> {
  return json("/projects/trials", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function applyProjectTrial(runId: string, generate: boolean): Promise<ProjectPlan & { undoToken: string; setup: SetupInfo; run: { runId: string; mode: "write" } | null }> {
  return json(`/projects/trials/${encodeURIComponent(runId)}/apply`, { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ generate }) });
}

export async function disposeProjectTrial(runId: string): Promise<void> {
  await json(`/projects/trials/${encodeURIComponent(runId)}/dispose`, { method: "POST", headers: LOCAL_HEADER, body: "{}" });
}

/**
 * Uploads a recording and runs the generator over a copy of the workspace
 * with it in place. The bytes go as they are; the project and the file's
 * name go as headers, because a JSON envelope around 30 MB of spans is a
 * copy nobody wants.
 */
export async function startTraceTrial(file: File, projectId: string): Promise<{ runId: string; mode: "trace-preview"; recording: string; project: string; stepAdded: boolean; spans: number }> {
  const response = await fetch(`${ROOT}/traces/trials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Portolan-Local": "1",
      "X-Portolan-Project": projectId,
      "X-Portolan-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const value = await response.json() as { runId: string; mode: "trace-preview"; recording: string; project: string; stepAdded: boolean; spans: number; error?: string };
  if (!response.ok) throw new LocalApiError(value.error || `Local API returned ${response.status}.`, { status: response.status });
  return value;
}

/** Keeps the recording beside the project, with the names mapped, and regenerates when asked. */
export async function applyTraceTrial(runId: string, options: { generate: boolean; services?: Record<string, string>; events?: Record<string, string>; routes?: Record<string, string> }): Promise<{ recording: string; project: string; stepAdded: boolean; manifestChanged: boolean; undoToken: string | null; setup: SetupInfo; run: { runId: string; mode: "write" } | null }> {
  return json(`/traces/trials/${encodeURIComponent(runId)}/apply`, { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(options) });
}

export async function disposeTraceTrial(runId: string): Promise<void> {
  await json(`/traces/trials/${encodeURIComponent(runId)}/dispose`, { method: "POST", headers: LOCAL_HEADER, body: "{}" });
}

export async function startGeneration(mode: "write" | "check" | "preview" = "preview", previewRunId?: string): Promise<{ runId: string; mode: "write" | "check" | "preview" }> {
  return json("/runs", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ mode, previewRunId }) });
}

export async function cancelGeneration(runId: string): Promise<void> {
  await json(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", headers: LOCAL_HEADER, body: "{}" });
}

// --- Branch drafts (portolan.0019) ------------------------------------------

export interface SavedDraftStatus {
  path: string;
  project: string;
  branch?: string;
  tip?: string;
  base?: string;
  generatedAt?: string;
  entities?: number;
  status: "fresh" | "moved" | "gone" | "failed" | "unreadable";
  currentTip?: string;
  ahead?: number;
  failure?: { message: string; at: string; step?: string };
}

export interface DraftBranches {
  main: string;
  projects: { id: string; name: string }[];
  branches: { branch: string; tip: string; base: string; ahead: number; projects: string[] }[];
}

type BranchDraftFile = import("./branch-draft").BranchDraft;
type DraftRef = { project: string; branch: string };
// Only the two names: a caller may hand in a whole draft, which is far more
// than the local API reads in one request.
const draftBody = ({ project, branch }: DraftRef): RequestInit => ({ method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ project, branch }) });

export function savedDrafts(): Promise<{ drafts: SavedDraftStatus[]; files: BranchDraftFile[] }> {
  return json("/drafts?files=1");
}
export function draftBranches(): Promise<DraftBranches> { return json("/drafts/branches"); }
export function generateBranchDraft(ref: DraftRef): Promise<{ runId: string; mode: "draft"; path: string }> { return json("/drafts/generate", draftBody(ref)); }
export function pendingBranchDraft(ref: DraftRef): Promise<BranchDraftFile> {
  return json(`/drafts/pending?project=${encodeURIComponent(ref.project)}&branch=${encodeURIComponent(ref.branch)}`);
}
export function saveBranchDraft(ref: DraftRef): Promise<{ path: string }> { return json("/drafts/save", draftBody(ref)); }
export function discardBranchDraft(ref: DraftRef): Promise<{ discarded: boolean }> { return json("/drafts/discard", draftBody(ref)); }
export function deleteBranchDraft(ref: DraftRef): Promise<{ deleted: boolean; path: string }> { return json("/drafts/delete", draftBody(ref)); }
export function restoreBranchDraft(ref: DraftRef): Promise<{ path: string }> { return json("/drafts/restore", draftBody(ref)); }

export function subscribeToRun(runId: string, onEvent: (event: RunEvent) => void, onEnd: () => void): () => void {
  const source = new EventSource(`${ROOT}/runs/${encodeURIComponent(runId)}/events`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as RunEvent);
  source.onerror = () => { source.close(); onEnd(); };
  return () => source.close();
}
