// Flow steps have catalog ids ("s6"); the LikeC4 edges that draw them have
// generated ones ("step-04:par.01"). Nothing in the model carries the catalog
// id across, so the two are paired by position.
//
// That is sound because it is the same walk twice: the generator emits steps in
// catalog order and this module inserts the same contract-response edges in the
// same places. If the two lists ever differ in length the pairing is abandoned
// rather than guessed at, and the diagram simply stops highlighting.

import type { Flow } from "../catalog";
import { walkSteps } from "../catalog";
import { hiddenStepIds } from "../flow/cross-context";

export interface EdgeStepPairing {
  /** LikeC4 edge id -> catalog step id */
  stepOf: Map<string, string>;
  /** catalog step id -> its primary LikeC4 edge id */
  edgeOf: Map<string, string>;
  /** catalog step id -> every edge it draws, including a contract response */
  edgesOf: Map<string, string[]>;
}

export const EMPTY_PAIRING: EdgeStepPairing = {
  stepOf: new Map(),
  edgeOf: new Map(),
  edgesOf: new Map(),
};

export function pairEdgesToSteps(
  edgeIds: readonly string[],
  stepIds: readonly string[],
): EdgeStepPairing {
  if (edgeIds.length !== stepIds.length) return EMPTY_PAIRING;
  const stepOf = new Map<string, string>();
  const edgeOf = new Map<string, string>();
  const edgesOf = new Map<string, string[]>();
  edgeIds.forEach((edgeId, i) => {
    const stepId = stepIds[i];
    if (stepId === undefined) return;
    stepOf.set(edgeId, stepId);
    if (!edgeOf.has(stepId)) edgeOf.set(stepId, edgeId);
    const edges = edgesOf.get(stepId) ?? [];
    edges.push(edgeId);
    edgesOf.set(stepId, edges);
  });
  return { stepOf, edgeOf, edgesOf };
}

/**
 * The frames an edge sits inside, outermost first.
 *
 * LikeC4 names an edge by the path that reaches it — "step-07:alt.02:else.01:
 * break.01" is the first message of the break inside the second branch of the
 * alt at step 7 — and every frame on the way has a node of its own under the
 * prefix that names it. So the containment the app needs is already written in
 * the id, and reading it back out beats pairing a second pair of trees.
 */
export function frameAncestors(edgeId: string): string[] {
  const parts = edgeId.split(".");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    out.push(parts.slice(0, i).join("."));
  }
  return out;
}

/**
 * Frames none of whose edges are on the chosen path.
 *
 * A frame with even one live edge inside it stays lit: the alt itself still
 * happens on this path, it is the arms not taken that do not. Only a frame
 * that contributes nothing at all is hidden.
 */
export function offPathFrameIds(
  edgeIds: readonly string[],
  onPath: ReadonlySet<string>,
): string[] {
  const live = new Set<string>();
  const seen: string[] = [];
  for (const edgeId of edgeIds) {
    for (const frame of frameAncestors(edgeId)) {
      if (!seen.includes(frame)) seen.push(frame);
      if (onPath.has(edgeId)) live.add(frame);
    }
  }
  return seen.filter((frame) => !live.has(frame));
}

/** The step ids a flow view draws, in the order its edges are emitted. */
export function drawnStepIds(flow: Flow, crossOnly: boolean): string[] {
  const steps = walkSteps(flow.steps);
  if (!crossOnly) return steps.map((s) => s.id);
  const hidden = hiddenStepIds(flow);
  return steps.filter((s) => !hidden.has(s.id)).map((s) => s.id);
}

/**
 * One step id per generated edge, including contract responses synthesized by
 * the LikeC4 generator. Nested RPCs return immediately; the actor request that
 * opened the flow returns after its final step.
 */
export function drawnEdgeStepIds(
  flow: Flow,
  crossOnly: boolean,
  responseStepIds: ReadonlySet<string>,
): string[] {
  const steps = walkSteps(flow.steps);
  const actorIds = new Set(
    flow.participants.filter((p) => p.kind === "actor").map((p) => p.id),
  );
  const deferred = steps.find(
    (step) =>
      step.kind === "rpc" &&
      actorIds.has(step.from) &&
      responseStepIds.has(step.id),
  )?.id;
  const drawn = drawnStepIds(flow, crossOnly);
  const out: string[] = [];
  for (const stepId of drawn) {
    out.push(stepId);
    if (stepId !== deferred && responseStepIds.has(stepId)) out.push(stepId);
  }
  if (deferred && drawn.includes(deferred)) out.push(deferred);
  return out;
}
