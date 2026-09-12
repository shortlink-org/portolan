// Where a problem's edge is met in the flows.
//
// A row on the Problems page names one end of an edge; the flows are where
// that edge is crossed, and the flow's page is where a reader sees what
// happens before and after it. So a row that knows its flows leads to the
// step, not to the flow's first line - and a row whose subject is a service
// leads to the flows the service is on, which is the best a service-shaped
// row can do.

import type { Catalog, CatalogIndex, Flow } from "../catalog";
import { walkSteps } from "../catalog";
import type { Problem } from "./derive";
import type { RuleSubject } from "./problem-rules-cel.mjs";

export interface FlowHit {
  flow: Flow;
  /** The step that crosses the edge, when one does; a flow the service is merely on has none. */
  stepId?: string;
  number?: number;
}

/** The store a table's or a column's id is under, by longest known prefix. */
function storeOf(index: CatalogIndex, id: string): string | null {
  const parts = id.split(".");
  for (let n = parts.length - 1; n >= 1; n -= 1) {
    const candidate = parts.slice(0, n).join(".");
    if (index.storeById.has(candidate)) return candidate;
  }
  return null;
}

function stepsWhere(catalog: Catalog, matches: (step: ReturnType<typeof walkSteps>[number]) => boolean): FlowHit[] {
  const out: FlowHit[] = [];
  for (const flow of catalog.flows) {
    const steps = walkSteps(flow.steps);
    const at = steps.findIndex(matches);
    if (at >= 0) out.push({ flow, stepId: steps[at]!.id, number: at + 1 });
  }
  return out;
}

function flowsOn(catalog: Catalog, serviceId: string): FlowHit[] {
  if (!serviceId) return [];
  return catalog.flows.filter((flow) => flow.participants.some((participant) => participant.id === serviceId)).map((flow) => ({ flow }));
}

/**
 * The flows a problem is met in, one hit per flow, the crossing step first
 * when the subject is an edge and the service's flows when it is not.
 */
export function flowsOfProblem(catalog: Catalog, index: CatalogIndex, over: RuleSubject, problem: Problem): FlowHit[] {
  switch (over) {
    case "call":
      return stepsWhere(catalog, (step) => step.ref === problem.id);
    // A channel row is an event when the service has one on the address and
    // the service otherwise; the second kind has no step to land on.
    case "event":
    case "consumer":
    case "channel": {
      const hits = stepsWhere(catalog, (step) => step.ref === problem.id);
      return hits.length > 0 || index.eventById.has(problem.id) ? hits : flowsOn(catalog, problem.service);
    }
    case "table":
    case "column": {
      const store = storeOf(index, problem.id);
      return store ? stepsWhere(catalog, (step) => step.storeAccess?.store === store) : [];
    }
    case "flow":
      return catalog.flows.filter((flow) => flow.id === problem.id).map((flow) => ({ flow }));
    case "aggregate":
      return stepsWhere(catalog, (step) => step.ref?.startsWith(`${problem.id}.`) === true || step.ref?.startsWith(`${problem.id}/`) === true);
    case "service":
    case "copy":
    case "subscription":
    case "deployment":
      return flowsOn(catalog, problem.service);
  }
}
