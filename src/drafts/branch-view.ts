// A flow's LikeC4 view as a branch has it. The view was laid out when the
// draft was generated and saved in it (portolan.0019), so the canvas draws the
// branch the way it draws main - the same renderer, a model with the branch's
// view in place of main's. What the branch did to a step colours its edges.
//
// The layouted view is LikeC4's internal shape, not a public API, which is
// the same bargain the container layout already makes.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { LikeC4Model } from "@likec4/core/model";
import type { Flow } from "../catalog";
import { likec4model } from "../likec4/generated";
import { flowCrossViewId, flowViewId } from "../likec4/ids";
import { drawnStepIds, pairEdgesToSteps } from "../likec4/flow-edges";
import type { EdgeStepPairing } from "../likec4/flow-edges";
import type { StepMark, StepMarkState } from "./branch-flow";
import type { Draft } from "./model";

export interface BranchView {
  model: LikeC4Model.Layouted;
  viewId: string;
  /** Which edge draws which step of the branch's flow. */
  pairing: EdgeStepPairing;
}

const COLOR: Record<StepMarkState, string> = {
  added: "green",
  changed: "blue",
  removed: "gray",
  main: "red",
};

/**
 * The saved view of a branch's flow, with the steps it changed coloured, in a
 * model main's views and elements fill out. Null when the draft saved no view
 * for it, and the page falls back to main's canvas.
 */
export function draftFlowView(draft: Draft, drawn: Flow, marks: ReadonlyMap<string, StepMark>, crossOnly: boolean): BranchView | null {
  const viewId = crossOnly ? flowCrossViewId(drawn) : flowViewId(drawn);
  const saved = draft.views[viewId] as any;
  if (!saved) return null;
  const view: any = structuredClone(saved);
  const pairing = pairEdgesToSteps(
    view.edges.map((edge: any) => String(edge.id)),
    drawnStepIds(drawn, crossOnly),
  );
  for (const [stepId, mark] of marks) {
    for (const edgeId of pairing.edgesOf.get(stepId) ?? []) {
      const edge = view.edges.find((candidate: any) => candidate.id === edgeId);
      if (!edge) continue;
      edge.color = COLOR[mark.state];
      if (mark.was) edge.notes = { txt: `was: ${mark.was}` };
    }
  }
  view.hash = `${view.hash ?? viewId}-${draft.branch}`;
  const data: any = likec4model.$data;
  const model = LikeC4Model.create({
    ...data,
    elements: { ...draft.elements, ...data.elements },
    views: { ...data.views, [viewId]: view },
  } as any) as LikeC4Model.Layouted;
  return { model, viewId, pairing };
}
