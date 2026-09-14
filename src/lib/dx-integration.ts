import type { SetupInfo, SetupRunStep, SetupStep } from "./setup-info";

export interface DxPlanSummary {
  entities: number;
  edges: number;
  relations: number;
}

export interface DxIntegrationModel {
  source?: SetupStep;
  sourceRun?: SetupRunStep;
  sourceMode: "live" | "snapshot" | "unknown";
  export?: SetupStep;
  exportRun?: SetupRunStep;
}

export function dxIntegrationModel(setup: SetupInfo, catalogId: string): DxIntegrationModel {
  const source = setup.steps.find((step) => step.plugin === "dx-source");
  const exported = setup.steps.find(
    (step) => step.plugin === "dx-export" && (!step.catalog || step.catalog === catalogId),
  );
  const sourceRun = setup.run?.steps.find((step) => step.plugin === "dx-source");
  const exportRun = setup.run?.steps.find(
    (step) => step.plugin === "dx-export" && (!step.catalog || step.catalog === catalogId),
  );
  const sourceMode = !sourceRun
    ? "unknown"
    : sourceRun.warnings.some((warning) => /snapshot|not fetched/i.test(warning))
      ? "snapshot"
      : "live";
  return { source, sourceRun, sourceMode, export: exported, exportRun };
}

export function summarizeDxPlan(value: unknown): DxPlanSummary {
  if (!value || typeof value !== "object") throw new Error("DX plan is not an object");
  const plan = value as Record<string, unknown>;
  if (plan.version !== 1 || !Array.isArray(plan.entities) || !Array.isArray(plan.relationEdges)) {
    throw new Error("DX plan has an unsupported shape");
  }
  let edges = 0;
  for (const candidate of plan.relationEdges) {
    if (!candidate || typeof candidate !== "object") throw new Error("DX plan has an invalid relation group");
    const relation = candidate as Record<string, unknown>;
    if (!relation.edges || typeof relation.edges !== "object" || Array.isArray(relation.edges)) {
      throw new Error("DX plan has invalid relation edges");
    }
    for (const targets of Object.values(relation.edges)) {
      if (!Array.isArray(targets)) throw new Error("DX plan has invalid relation targets");
      edges += targets.length;
    }
  }
  return { entities: plan.entities.length, edges, relations: plan.relationEdges.length };
}
