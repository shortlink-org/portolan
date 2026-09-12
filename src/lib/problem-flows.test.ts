// A problem row leads to the step that crosses its edge, or to the flows
// its service is on when the subject is not an edge.

import { describe, expect, it } from "vitest";
import { rawCatalog } from "../test-catalog";
import { buildIndex, validateCatalog, walkSteps } from "../catalog";
import type { Catalog } from "../catalog";
import type { Problem } from "./derive";
import { flowsOfProblem } from "./problem-flows";

const catalog = validateCatalog(JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog);
const index = buildIndex(catalog);

const problem = (id: string, service: string): Problem => ({ rule: "x", severity: "warning", context: "", service, id, peer: "", note: undefined, source: undefined });

/** The first step in the estate of one kind with a ref, and its flow and number. */
function firstStep(kind: "rpc" | "event") {
  for (const flow of catalog.flows) {
    const steps = walkSteps(flow.steps);
    const at = steps.findIndex((step) => step.kind === kind && step.ref);
    if (at >= 0) return { flow, step: steps[at]!, number: at + 1 };
  }
  throw new Error(`the fixture has no ${kind} step with a ref`);
}

describe("flowsOfProblem", () => {
  it("lands a call on the step that makes it", () => {
    const { flow, step, number } = firstStep("rpc");
    const hits = flowsOfProblem(catalog, index, "call", problem(step.ref!, step.from));
    expect(hits.map((hit) => hit.flow.id)).toContain(flow.id);
    const hit = hits.find((candidate) => candidate.flow.id === flow.id)!;
    expect(hit.stepId).toBe(step.id);
    expect(hit.number).toBe(number);
  });

  it("lands an event on the step that carries it, once per flow", () => {
    const { flow, step } = firstStep("event");
    const hits = flowsOfProblem(catalog, index, "event", problem(step.ref!, step.from));
    expect(hits.some((hit) => hit.flow.id === flow.id && hit.stepId === step.id)).toBe(true);
    expect(new Set(hits.map((hit) => hit.flow.id)).size).toBe(hits.length);
  });

  it("lands a table on the steps that touch its store", () => {
    const access = catalog.flows.flatMap((flow) => walkSteps(flow.steps)).find((step) => step.storeAccess);
    if (!access?.storeAccess) return;
    const store = index.storeById.get(access.storeAccess.store)!;
    const table = store.tables[0]!;
    const hits = flowsOfProblem(catalog, index, "table", problem(table.id, store.owner));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.stepId !== undefined)).toBe(true);
    expect(flowsOfProblem(catalog, index, "column", problem(`${table.id}.${table.columns[0]!.name}`, store.owner)).length).toBe(hits.length);
  });

  it("gives a service-shaped row the flows the service is on, without a step", () => {
    const service = catalog.contexts[0]!.services[0]!;
    const hits = flowsOfProblem(catalog, index, "service", problem(service.id, service.id));
    expect(hits.length).toBe(catalog.flows.filter((flow) => flow.participants.some((p) => p.id === service.id)).length);
    expect(hits.every((hit) => hit.stepId === undefined)).toBe(true);
    expect(flowsOfProblem(catalog, index, "deployment", problem("argocd/x", ""))).toEqual([]);
  });
});
