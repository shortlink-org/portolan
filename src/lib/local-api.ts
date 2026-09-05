import type { SetupInfo, SetupPhase, SetupRunStepStatus } from "./setup-info";

const ROOT = "/__portolan";
const LOCAL_HEADER = { "Content-Type": "application/json", "X-Portolan-Local": "1" };

export interface Detection {
  plugin: string;
  confidence: "high" | "medium";
  evidence: string;
  selected: boolean;
}

export interface Discovery {
  root: string;
  filesScanned: number;
  truncated: boolean;
  defaults: { id: string; name: string; context: string; service: string };
  detections: Detection[];
}

export interface ProjectDraft {
  root: string;
  repository: string;
  id: string;
  name: string;
  context: string;
  service: string;
  plugins: string[];
}

export interface ProjectPlan {
  project: { id: string; name: string; root: string; context?: string; service?: string; repository?: string };
  plugins: string[];
  steps: Array<{ plugin: string; in: string; out: string; options: Record<string, unknown> }>;
  source: string;
  discovery: Discovery;
}

export type RunEvent =
  | { type: "run-started"; at: string; runId: string; mode: "write" | "check" }
  | { type: "pipeline-ready"; at: string; stepCount: number }
  | { type: "step-started"; at: string; ordinal: number; phase: SetupPhase; plugin: string; input?: string; output: string }
  | { type: "step-finished"; at: string; ordinal: number; phase: SetupPhase; plugin: string; status: SetupRunStepStatus; durationMs: number; fileCount: number; changedCount: number; message?: string }
  | { type: "run-finished"; at: string; status: string; durationMs?: number; message?: string }
  | { type: "process-finished"; at: string; status: string; durationMs?: number; message?: string }
  | { type: "log"; at: string; stream: "stdout" | "stderr"; message: string };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, init);
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `Local API returned ${response.status}.`);
  return value;
}

export async function localStatus(): Promise<{ local: true; setup: SetupInfo; activeRun: { id: string; mode: "write" | "check" } | null }> {
  return json("/status");
}

export async function discover(path: string): Promise<Discovery> {
  return json("/discover", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ path }) });
}

export async function previewProject(draft: ProjectDraft): Promise<ProjectPlan> {
  return json("/projects/preview", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function addProject(draft: ProjectDraft): Promise<ProjectPlan & { setup: SetupInfo }> {
  return json("/projects", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify(draft) });
}

export async function startGeneration(mode: "write" | "check" = "write"): Promise<{ runId: string; mode: "write" | "check" }> {
  return json("/runs", { method: "POST", headers: LOCAL_HEADER, body: JSON.stringify({ mode }) });
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
