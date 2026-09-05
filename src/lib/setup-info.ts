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

export interface SetupInfo {
  projects: SetupProject[];
  plugins: SetupPlugin[];
  steps: SetupStep[];
  sources: string[];
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

/** Reduce an untrusted manifest to the fields the static UI may publish. */
export function publicSetupFrom(value: unknown): SetupInfo {
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

  return {
    projects,
    plugins,
    steps,
    sources: array(manifest.sources).filter(
      (source): source is string => typeof source === "string",
    ),
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

  return {
    id: item.id,
    name: item.name,
    root: cleanPath(item.root),
    ...(typeof item.context === "string" ? { context: item.context } : {}),
    ...(typeof item.service === "string" ? { service: item.service } : {}),
    ...(typeof item.repository === "string"
      ? { repository: item.repository }
      : {}),
  };
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
    runtime: item.wasm === undefined ? "process" : "wasm",
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
