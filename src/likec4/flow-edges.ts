// Flow steps have catalog ids ("s6"); the LikeC4 edges that draw them have
// generated ones ("step-04:par.01"). Nothing in the model carries the catalog
// id across, so the two are paired by position.
//
// That is sound because it is the same walk twice: the generator emits steps in
// the order walkSteps visits them — a step, then each branch of a parallel,
// then each branch of an alt, then the body of a loop — and the view keeps that
// order in its edge list. If the two lists ever differ in length the pairing is
// abandoned rather than guessed at, and the diagram simply stops highlighting.

import type { Flow } from "../catalog";
import { walkSteps } from "../catalog";
import { hiddenStepIds } from "../flow/cross-context";

export interface EdgeStepPairing {
  /** LikeC4 edge id -> catalog step id */
  stepOf: Map<string, string>;
  /** catalog step id -> LikeC4 edge id */
  edgeOf: Map<string, string>;
}

export const EMPTY_PAIRING: EdgeStepPairing = {
  stepOf: new Map(),
  edgeOf: new Map(),
};

export function pairEdgesToSteps(
  edgeIds: readonly string[],
  stepIds: readonly string[],
): EdgeStepPairing {
  if (edgeIds.length !== stepIds.length) return EMPTY_PAIRING;
  const stepOf = new Map<string, string>();
  const edgeOf = new Map<string, string>();
  edgeIds.forEach((edgeId, i) => {
    const stepId = stepIds[i];
    if (stepId === undefined) return;
    stepOf.set(edgeId, stepId);
    edgeOf.set(stepId, edgeId);
  });
  return { stepOf, edgeOf };
}

/** The step ids a flow view draws, in the order its edges are emitted. */
export function drawnStepIds(flow: Flow, crossOnly: boolean): string[] {
  const steps = walkSteps(flow.steps);
  if (!crossOnly) return steps.map((s) => s.id);
  const hidden = hiddenStepIds(flow);
  return steps.filter((s) => !hidden.has(s.id)).map((s) => s.id);
}
