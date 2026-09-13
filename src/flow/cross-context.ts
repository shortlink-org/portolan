// The cross-context predicate. Data logic, not rendering: the LikeC4 generator
// applies it when emitting the *_cross views, and the step rail applies it to
// stay in step with whichever view is on screen.

import type { Flow, Step } from "../catalog-model.ts";
import { walkSteps } from "../catalog-model.ts";

export function isCrossContext(
  step: Step,
  contextOf: (participantId: string) => string | null,
): boolean {
  if (step.kind === "call") return false;
  if (step.from === step.to) return false;
  const a = contextOf(step.from);
  const b = contextOf(step.to);
  // "Cross-context" means exactly that: both ends belong to bounded
  // contexts and those contexts differ. Actor, broker and external-system
  // boundaries are useful, but they are a different question and must not be
  // smuggled into this filter under a broader meaning.
  return a !== null && b !== null && a !== b;
}

export function contextResolver(
  flow: Flow,
): (participantId: string) => string | null {
  const contexts = new Map(flow.participants.map((p) => [p.id, p.context]));
  return (id) => contexts.get(id) ?? null;
}

/** Only flows with a real crossing need a separate generated view. */
export function hasCrossContextSteps(flow: Flow): boolean {
  const contextOf = contextResolver(flow);
  return walkSteps(flow.steps).some((step) => isCrossContext(step, contextOf));
}

/** Ids of the steps a cross-context view leaves out. */
export function hiddenStepIds(flow: Flow): Set<string> {
  const contextOf = contextResolver(flow);
  return new Set(
    walkSteps(flow.steps)
      .filter((step) => !isCrossContext(step, contextOf))
      .map((step) => step.id),
  );
}
