// What a generated view actually contains.
//
// Highlighting has to know two things before it touches the canvas: whether the
// view on screen holds the selected element at all, and — for flows — which
// edge draws which step. Both are answered from the generated model, so neither
// costs a render and neither can drift from what LikeC4 will draw.

import { likec4model } from "./generated";
import type { Flow } from "../catalog";
import { drawnStepIds, pairEdgesToSteps } from "./flow-edges";
import type { EdgeStepPairing } from "./flow-edges";
import { EMPTY_PAIRING } from "./flow-edges";
import { flowCrossViewId, flowViewId } from "./ids";

interface ViewShape {
  nodeIds: Set<string>;
  edgeIds: string[];
}

const shapes = new Map<string, ViewShape>();

function shapeOf(viewId: string): ViewShape {
  const cached = shapes.get(viewId);
  if (cached) return cached;
  const view = likec4model.findView(viewId)?.$layouted;
  const shape: ViewShape = view
    ? {
        nodeIds: new Set(view.nodes.map((n) => String(n.id))),
        edgeIds: view.edges.map((e) => String(e.id)),
      }
    : { nodeIds: new Set(), edgeIds: [] };
  shapes.set(viewId, shape);
  return shape;
}

/** True when the view draws a node with this LikeC4 element id. */
export function viewHasNode(viewId: string, likec4Id: string): boolean {
  return shapeOf(viewId).nodeIds.has(likec4Id);
}

const pairings = new Map<string, EdgeStepPairing>();

/** Edge-to-step pairing for one of a flow's two views. */
export function flowPairing(flow: Flow, crossOnly: boolean): EdgeStepPairing {
  const viewId = crossOnly ? flowCrossViewId(flow) : flowViewId(flow);
  const cached = pairings.get(viewId);
  if (cached) return cached;
  const pairing = shapeOf(viewId).edgeIds.length
    ? pairEdgesToSteps(shapeOf(viewId).edgeIds, drawnStepIds(flow, crossOnly))
    : EMPTY_PAIRING;
  pairings.set(viewId, pairing);
  return pairing;
}
