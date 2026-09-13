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
  kind: "entrypoint" | "handoff" | "event";
  basis: string;
  confidence: "high" | "medium";
}

/** The first executable hop of a flow. */
export function openingStep(flow: Flow): Step | undefined {
  return walkSteps(flow.steps)[0];
}

/** The ref the flow opens with, or undefined for a flow that opens with none. */
export function openingRef(flow: Flow): string | undefined {
  return openingStep(flow)?.ref;
}

function continuation(step: Step, flow: Flow): Continuation | null {
  const opening = openingStep(flow);
  if (!opening) return null;

  const sourceEntry = [step.continuesAt, ...(step.reaches ?? [])].find(
    (entry) => entry && flow.entrypoint === entry,
  );
  if (sourceEntry) {
    return {
      slug: flow.slug,
      name: flow.name,
      kind: "entrypoint",
      basis:
        step.continuesAt === sourceEntry
          ? `enters ${sourceEntry}`
          : `reaches ${sourceEntry}`,
      confidence: "high",
    };
  }

  if (
    step.handoff?.direction === "send" &&
    opening.handoff?.direction === "receive" &&
    step.handoff.kind === opening.handoff.kind &&
    step.handoff.transport === opening.handoff.transport &&
    step.handoff.channel === opening.handoff.channel &&
    (step.handoff.message ?? "") === (opening.handoff.message ?? "")
  ) {
    return {
      slug: flow.slug,
      name: flow.name,
      kind: "handoff",
      basis: `${step.handoff.transport} · ${step.handoff.channel}`,
      confidence: "high",
    };
  }

  // A shared domain event is useful navigation, but weaker than a proven
  // source entry or transport handoff. RPC refs are deliberately excluded:
  // two flows calling the same method do not continue one another.
  if (step.kind === "event" && opening.kind === "event" && step.ref && opening.ref === step.ref) {
    return {
      slug: flow.slug,
      name: flow.name,
      kind: "event",
      basis: step.ref,
      confidence: "medium",
    };
  }
  return null;
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
  return flows
    .filter((flow) => flow.slug !== from.slug)
    .flatMap((flow) => {
      const match = continuation(step, flow);
      return match ? [match] : [];
    });
}

/** Continuations for every step of a flow at once, keyed by step id. */
export function continuationIndex(
  flow: Flow,
  flows: readonly Flow[],
): Map<string, Continuation[]> {
  // One pass over the other flows rather than one per step: a flow with forty
  // steps would otherwise walk the whole catalog forty times.
  const candidates = flows.filter((other) => other.slug !== flow.slug);
  const byRef = new Map<string, Continuation[]>();
  for (const other of flows) {
    if (other.slug === flow.slug) continue;
    const opening = openingStep(other);
    if (!opening?.ref || opening.kind !== "event") continue;
    const list = byRef.get(opening.ref) ?? [];
    list.push({
      slug: other.slug,
      name: other.name,
      kind: "event",
      basis: opening.ref,
      confidence: "medium",
    });
    byRef.set(opening.ref, list);
  }

  const out = new Map<string, Continuation[]>();
  for (const step of walkSteps(flow.steps)) {
    const exact = candidates.flatMap((other) => {
      const match = continuation(step, other);
      return match && match.kind !== "event" ? [match] : [];
    });
    const inferred = step.kind === "event" && step.ref ? byRef.get(step.ref) ?? [] : [];
    const hits = [...exact, ...inferred].filter(
      (hit, index, all) => all.findIndex((candidate) => candidate.slug === hit.slug) === index,
    );
    if (hits.length > 0) out.set(step.id, hits);
  }
  return out;
}
