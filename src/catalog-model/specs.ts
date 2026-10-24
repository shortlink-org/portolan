// Spec-driven changes are intent records. They stay separate from the
// architecture facts they may eventually change: a completed checklist is
// not runtime evidence, and an accepted proposal is not an implementation.

export type SpecFormat = "openspec" | "spec-kit" | "kiro";
export type SpecLifecycle =
  | "draft"
  | "planned"
  | "implementing"
  | "complete"
  | "archived";

export interface SpecArtifact {
  kind: "proposal" | "design" | "tasks" | "requirements";
  path: string;
  body: string;
}

export interface SpecScenario {
  name: string;
  when: string[];
  then: string[];
}

export interface SpecRequirement {
  id: string;
  title: string;
  text: string;
  source: string;
  scenarios: SpecScenario[];
}

export interface SpecTask {
  id: string;
  title: string;
  done: boolean;
  source: string;
}

export interface ChangeSpec {
  id: string;
  slug: string;
  title: string;
  format: SpecFormat;
  lifecycle: SpecLifecycle;
  source: string;
  artifacts: SpecArtifact[];
  requirements: SpecRequirement[];
  tasks: SpecTask[];
}

export function allSpecs(catalog: { specs?: ChangeSpec[] }): ChangeSpec[] {
  return catalog.specs ?? [];
}
