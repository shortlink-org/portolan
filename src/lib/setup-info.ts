/**
 * The public, read-only part of portolan.json.
 *
 * The manifest also contains process commands and arbitrary plugin options.
 * Those are build inputs, not facts a deployed catalog needs to publish, so
 * vite.config.ts reduces the manifest to this shape before putting it in the
 * bundle.
 */

export type SetupPhase = "extract" | "verify" | "generate";

export interface SetupProject {
  id: string;
  name: string;
  root: string;
  context?: string;
  service?: string;
  repository?: string;
}

export interface SetupStep {
  phase: SetupPhase;
  plugin: string;
  input?: string;
  output: string;
  projectId?: string;
}

export interface SetupPlugin {
  name: string;
  runtime: "wasm" | "process";
  phases: SetupPhase[];
  stepCount: number;
  projectIds: string[];
}

export type SetupRunStatus = "ok" | "drifted" | "failed" | "running";
export type SetupRunStepStatus =
  | "up-to-date"
  | "written"
  | "drifted"
  | "failed";

export interface SetupRunStep extends SetupStep {
  ordinal: number;
  status: SetupRunStepStatus;
  durationMs: number;
  fileCount: number;
  changedCount: number;
  files: string[];
}

export interface SetupRun {
  mode: "check" | "write";
  status: SetupRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: SetupRunStep[];
}

export interface SetupInfo {
  projects: SetupProject[];
  plugins: SetupPlugin[];
  steps: SetupStep[];
  sources: string[];
  run?: SetupRun;
  reportStale?: boolean;
}

interface ManifestPlugin {
  name?: unknown;
  wasm?: unknown;
  process?: unknown;
}

interface ManifestStep {
  plugin?: unknown;
  in?: unknown;
  out?: unknown;
}

interface ManifestProject {
  id?: unknown;
  name?: unknown;
  root?: unknown;
  context?: unknown;
  service?: unknown;
  repository?: unknown;
}

interface Manifest {
  projects?: unknown;
  plugins?: unknown;
  sources?: unknown;
  extract?: unknown;
  verify?: unknown;
  generate?: unknown;
}

const PHASES: SetupPhase[] = ["extract", "verify", "generate"];
const RUN_STATUSES: SetupRunStatus[] = ["ok", "drifted", "failed", "running"];
const STEP_STATUSES: SetupRunStepStatus[] = [
  "up-to-date",
  "written",
  "drifted",
  "failed",
];

/** Reduce an untrusted manifest to the fields the static UI may publish. */
export function publicSetupFrom(
  value: unknown,
  reportValue?: unknown,
  expectedManifestSha256?: string,
): SetupInfo {
  const manifest = record(value) as Manifest;
  const projects = array(manifest.projects)
    .map((item) => projectFrom(item))
    .filter((item): item is SetupProject => item !== null);

  const steps = PHASES.flatMap((phase) =>
    array(manifest[phase])
      .map((item) => stepFrom(item, phase, projects))
      .filter((item): item is SetupStep => item !== null),
  );

  const plugins = array(manifest.plugins)
    .map((item) => pluginFrom(item, steps))
    .filter((item): item is SetupPlugin => item !== null);

  const result: SetupInfo = {
    projects,
    plugins,
    steps,
    sources: array(manifest.sources).filter(
      (source): source is string => typeof source === "string",
    ),
  };

  const report = record(reportValue);
  if (Object.keys(report).length > 0) {
    const matchesManifest =
      expectedManifestSha256 === undefined ||
      report.manifestSha256 === expectedManifestSha256;
    if (!matchesManifest) {
      result.reportStale = true;
    } else {
      const run = runFrom(report, projects, steps);
      if (run) result.run = run;
    }
  }

  return result;
}

function runFrom(
  value: Record<string, unknown>,
  projects: SetupProject[],
  declaredSteps: SetupStep[],
): SetupRun | null {
  if (
    value.version !== 1 ||
    (value.mode !== "check" && value.mode !== "write") ||
    !RUN_STATUSES.includes(value.status as SetupRunStatus) ||
    typeof value.startedAt !== "string" ||
    !validDate(value.startedAt) ||
    typeof value.finishedAt !== "string" ||
    (value.finishedAt !== "" && !validDate(value.finishedAt)) ||
    !finiteNumber(value.durationMs)
  ) {
    return null;
  }

  const steps = array(value.steps)
    .map((item) => runStepFrom(item, projects, declaredSteps))
    .filter((item): item is SetupRunStep => item !== null);

  return {
    mode: value.mode,
    status: value.status as SetupRunStatus,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    durationMs: value.durationMs,
    steps,
  };
}

function runStepFrom(
  value: unknown,
  projects: SetupProject[],
  declaredSteps: SetupStep[],
): SetupRunStep | null {
  const item = record(value);
  if (
    !PHASES.includes(item.phase as SetupPhase) ||
    typeof item.plugin !== "string" ||
    typeof item.output !== "string" ||
    !safeRelativePath(item.output) ||
    !STEP_STATUSES.includes(item.status as SetupRunStepStatus) ||
    !wholeNumber(item.ordinal) ||
    !finiteNumber(item.durationMs) ||
    !wholeNumber(item.fileCount) ||
    !wholeNumber(item.changedCount)
  ) {
    return null;
  }

  const input =
    typeof item.input === "string" && safeRelativePath(item.input)
      ? cleanPath(item.input)
      : undefined;
  const project = input ? projectFor(input, projects) : undefined;
  const declared = declaredSteps[item.ordinal];
  if (
    !declared ||
    declared.phase !== item.phase ||
    declared.plugin !== item.plugin ||
    declared.input !== input ||
    declared.output !== cleanPath(item.output)
  ) {
    return null;
  }
  const files = array(item.files).filter(
    (file): file is string => typeof file === "string" && safeRelativePath(file),
  );

  return {
    ordinal: item.ordinal,
    phase: item.phase as SetupPhase,
    plugin: item.plugin,
    ...(input ? { input } : {}),
    output: cleanPath(item.output),
    ...(declared.projectId
      ? { projectId: declared.projectId }
      : project
        ? { projectId: project.id }
        : {}),
    status: item.status as SetupRunStepStatus,
    durationMs: item.durationMs,
    fileCount: item.fileCount,
    changedCount: item.changedCount,
    files,
  };
}

function projectFrom(value: unknown): SetupProject | null {
  const item = record(value) as ManifestProject;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.root !== "string"
  ) {
    return null;
  }

  const repository =
    typeof item.repository === "string" ? repositoryUrl(item.repository) : null;

  return {
    id: item.id,
    name: item.name,
    root: cleanPath(item.root),
    ...(typeof item.context === "string" ? { context: item.context } : {}),
    ...(typeof item.service === "string" ? { service: item.service } : {}),
    ...(repository ? { repository } : {}),
  };
}

/**
 * A repository as a page a browser can open: a remote spelled for ssh is
 * rewritten, the .git suffix dropped. Whatever is not http(s) after that is
 * dropped rather than published - the value ends up in an href, and the
 * manifest this reads is not trusted to only hold ones that are safe there.
 */
function repositoryUrl(raw: string): string | null {
  const url = raw
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : null;
}

function stepFrom(
  value: unknown,
  phase: SetupPhase,
  projects: SetupProject[],
): SetupStep | null {
  const item = record(value) as ManifestStep;
  if (typeof item.plugin !== "string" || typeof item.out !== "string") {
    return null;
  }

  const input = typeof item.in === "string" ? cleanPath(item.in) : undefined;
  const project = input ? projectFor(input, projects) : undefined;
  return {
    phase,
    plugin: item.plugin,
    ...(input ? { input } : {}),
    output: cleanPath(item.out),
    ...(project ? { projectId: project.id } : {}),
  };
}

function pluginFrom(
  value: unknown,
  steps: SetupStep[],
): SetupPlugin | null {
  const item = record(value) as ManifestPlugin;
  if (typeof item.name !== "string") return null;
  const own = steps.filter((step) => step.plugin === item.name);

  return {
    name: item.name,
    // The sandbox is claimed only where the manifest actually declares one.
    // Settings prints this as a promise about filesystem, network and
    // environment access, so a `wasm` that is not a module - null, a bare
    // true, a half-written object - answers "process", which promises nothing.
    runtime: typeof record(item.wasm)["url"] === "string" ? "wasm" : "process",
    phases: PHASES.filter((phase) => own.some((step) => step.phase === phase)),
    stepCount: own.length,
    projectIds: [
      ...new Set(
        own
          .map((step) => step.projectId)
          .filter((id): id is string => id !== undefined),
      ),
    ],
  };
}

/** Longest root wins, so a nested project is not claimed by its parent. */
function projectFor(
  input: string,
  projects: SetupProject[],
): SetupProject | undefined {
  return projects
    .filter(
      (project) => input === project.root || input.startsWith(`${project.root}/`),
    )
    .sort((a, b) => b.root.length - a.root.length)[0];
}

function cleanPath(path: string): string {
  return path.replace(/\/+$/, "");
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !/^[a-z]:/i.test(path) &&
    !path.split(/[\\/]/).includes("..")
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function wholeNumber(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value);
}

function validDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

declare const __SETUP_INFO__: SetupInfo | undefined;

const EMPTY: SetupInfo = { projects: [], plugins: [], steps: [], sources: [] };

/** The configuration snapshot embedded into this particular build. */
export const setupInfo: SetupInfo =
  typeof __SETUP_INFO__ === "undefined" ? EMPTY : __SETUP_INFO__;
