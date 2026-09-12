import type { SetupDiagnostic, SetupInfo, SetupPhase, SetupProject, SetupRunStepStatus } from "./setup-info";
import type { DjangoAggregateCandidates } from "./django-aggregates";

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
  mappings: { services: Record<string, string>; events: Record<string, string> };
}

export type RunMode = "write" | "check" | "preview" | "project-preview" | "trace-preview";

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
export async function applyTraceTrial(runId: string, options: { generate: boolean; services?: Record<string, string>; events?: Record<string, string> }): Promise<{ recording: string; project: string; stepAdded: boolean; manifestChanged: boolean; undoToken: string | null; setup: SetupInfo; run: { runId: string; mode: "write" } | null }> {
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

export function subscribeToRun(runId: string, onEvent: (event: RunEvent) => void, onEnd: () => void): () => void {
  const source = new EventSource(`${ROOT}/runs/${encodeURIComponent(runId)}/events`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as RunEvent);
  source.onerror = () => { source.close(); onEnd(); };
  return () => source.close();
}
