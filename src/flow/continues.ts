// Where a flow hands off to another one.
//
// A step that publishes an event is often the last thing one flow says and the
// first thing another one hears. Nothing in the catalog states that seam — it
// is not a field, it is a coincidence of two refs — but it is the single most
// useful link a rail can carry, because it is the answer to "and then what?"
// that the flow itself cannot give.
//
// The rule is deliberately strict: only the FIRST step of the other flow
// counts. A flow that merely mentions the same event somewhere in its middle
// is not continuing this one, it is another reader of the same event, and the
// event page already says so.

import type { Flow, Step } from "../catalog";
import { walkSteps } from "../catalog";

export interface Continuation {
  slug: string;
  name: string;
}

/** The ref the flow opens with, or undefined for a flow that opens with none. */
export function openingRef(flow: Flow): string | undefined {
  return walkSteps(flow.steps)[0]?.ref;
}

/**
 * Flows that begin where this step ends. `from` is the flow the step belongs
 * to and is never returned: a flow does not continue in itself.
 */
export function continuationsOf(
  step: Step,
  from: Flow,
  flows: readonly Flow[],
): Continuation[] {
  if (!step.ref) return [];
  return flows
    .filter((flow) => flow.slug !== from.slug && openingRef(flow) === step.ref)
    .map((flow) => ({ slug: flow.slug, name: flow.name }));
}

/** Continuations for every step of a flow at once, keyed by step id. */
export function continuationIndex(
  flow: Flow,
  flows: readonly Flow[],
): Map<string, Continuation[]> {
  // One pass over the other flows rather than one per step: a flow with forty
  // steps would otherwise walk the whole catalog forty times.
  const byRef = new Map<string, Continuation[]>();
  for (const other of flows) {
    if (other.slug === flow.slug) continue;
    const ref = openingRef(other);
    if (!ref) continue;
    const list = byRef.get(ref) ?? [];
    list.push({ slug: other.slug, name: other.name });
    byRef.set(ref, list);
  }

  const out = new Map<string, Continuation[]>();
  for (const step of walkSteps(flow.steps)) {
    const hits = step.ref ? byRef.get(step.ref) : undefined;
    if (hits && hits.length > 0) out.set(step.id, hits);
  }
  return out;
}
