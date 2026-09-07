import type { SetupInfo, SetupPhase, SetupRunStepStatus } from "./setup-info";

const ROOT = "/__portolan";
const LOCAL_HEADER = { "Content-Type": "application/json", "X-Portolan-Local": "1" };

export interface Detection {
  plugin: string;
  confidence: "high" | "medium";
  evidence: string;
  candidates: string[];
  options: Record<string, unknown>;
  selected: boolean;
}

export interface Discovery {
  root: string;
  filesScanned: number;
  truncated: boolean;
  components: Array<{ path: string; name: string; markers: string[]; technologies: string[] }>;
  componentsTruncated: boolean;
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
  groupKind?: "bounded-context" | "system" | "product" | "team" | "namespace";
  componentKind?: "service" | "application" | "webapp" | "worker" | "job" | "function" | "cli" | "library" | "data-pipeline";
  plugins: string[];
}

export interface ProjectPlan {
  project: { id: string; name: string; root: string; group?: string; component?: string; groupKind?: string; componentKind?: string; context?: string; service?: string; repository?: string };
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
  message?: string;
}

export interface ProjectTrial {
  plan: ProjectPlan;
  steps: ProjectTrialStep[];
  facts: ProjectTrialFact[];
  warnings: Array<{ plugin: string; message: string }>;
  generatedFiles: number;
  previewUrl?: string;
  previewError?: string;
}

export type RunEvent =
  | { type: "run-started"; at: string; runId: string; mode: "write" | "check" | "preview" | "project-preview" }
  | { type: "pipeline-ready"; at: string; stepCount: number }
  | { type: "step-started"; at: string; ordinal: number; phase: SetupPhase; plugin: string; input?: string; output: string }
  | { type: "step-finished"; at: string; ordinal: number; phase: SetupPhase; plugin: string; status: SetupRunStepStatus; durationMs: number; fileCount: number; changedCount: number; changes: Array<{ kind: "added" | "changed" | "removed"; path: string }>; files: string[]; warnings?: string[]; message?: string }
  | { type: "preview-ready"; at: string; files: GeneratedFileDiff[]; totalFiles: number; truncated: boolean }
  | ({ type: "project-trial-ready"; at: string } & ProjectTrial)
  | { type: "run-finished"; at: string; status: string; durationMs?: number; message?: string }
  | { type: "process-finished"; at: string; status: string; durationMs?: number; message?: string }
  | { type: "log"; at: string; stream: "stdout" | "stderr"; message: string };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, init);
  const value = await response.json() as T & { error?: string; code?: string; retryable?: boolean; provider?: string };
  if (!response.ok) throw new LocalApiError(value.error || `Local API returned ${response.status}.`, {
    status: response.status,
    code: value.code,
    retryable: value.retryable,
    provider: value.provider,
  });
  return value;
}

export class LocalApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable: boolean;
  readonly provider?: string;

  constructor(message: string, options: { status: number; code?: string; retryable?: boolean; provider?: string }) {
    super(message);
    this.name = "LocalApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
  }
}

export async function localStatus(): Promise<{ local: true; setup: SetupInfo; activeRun: { id: string; mode: "write" | "check" | "preview" } | null }> {
  return json("/status");
}

export async function discover(path: string): Promise<Discovery> {
  return json("/discover", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ path }) });
}

export async function inspectRepository(repository: string, ref: string, sourcePath: string): Promise<RepositoryInspection> {
  return json("/repositories/prepare", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ repository, ref, sourcePath }) });
}

export async function previewProject(draft: ProjectDraft): Promise<ProjectPlan> {
  return json("/projects/preview", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function addProject(draft: ProjectDraft): Promise<ProjectPlan & { setup: SetupInfo }> {
  return json("/projects", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function startProjectTrial(draft: ProjectDraft): Promise<{ runId: string; mode: "project-preview"; plan: ProjectPlan }> {
  return json("/projects/trials", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function applyProjectTrial(runId: string, generate: boolean): Promise<ProjectPlan & { setup: SetupInfo; run: { runId: string; mode: "write" } | null }> {
  return json(`/projects/trials/${encodeURIComponent(runId)}/apply`, { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ generate }) });
}

export async function disposeProjectTrial(runId: string): Promise<void> {
  await json(`/projects/trials/${encodeURIComponent(runId)}/dispose`, { method: "POST", headers: LOCAL_HEADER, body: "{}" });
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
