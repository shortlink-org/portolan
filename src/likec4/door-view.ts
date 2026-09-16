// The picture of one opened door, fetched when it is opened.
//
// A LikeC4 view is laid out before it is drawn, so only a shape decided
// beforehand can have one (portolan.0026). The whole path is one such shape
// and travels in the bundle; a single opened continuation is another, and
// there are as many of those as there are doors in the estate - a few hundred
// in a real one. Putting them all in the bundle would make every reader pay
// for every door on the first page they open, so they are laid out beside the
// site and one is fetched when a reader opens it (portolan.0027).
//
// The model the view is put into is main's, with this view added - the same
// bargain `drafts/branch-view.ts` makes for a branch's picture, and the same
// internal shape.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { LikeC4Model } from "@likec4/core/model";
import type { Flow } from "../catalog";
import { likec4model } from "./generated";
import { flowDoorViewId, flowViewId } from "./ids";
import { drawnStepIds, pairEdgesToSteps } from "./flow-edges";
import type { EdgeStepPairing } from "./flow-edges";

export interface DoorView {
  model: LikeC4Model.Layouted;
  viewId: string;
  pairing: EdgeStepPairing;
}

/** One fetch per door per session, whatever asks for it. */
const loading = new Map<string, Promise<DoorView | null>>();

/** Where the generator wrote it, under the site's own base. */
function href(viewId: string): string {
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}portolan-assets/likec4/journeys/${encodeURIComponent(viewId)}.json`;
}

/**
 * The view for this flow with one door opened, and the model to draw it in.
 * Null when the site has no such view - an estate generated before this
 * existed, a door deeper than the flow's own steps - and the page then keeps
 * the flow's own picture rather than drawing something else.
 *
 * `drawn` is the composed flow the view was generated from; its steps pair
 * with the view's edges in order, as everywhere else.
 */
export function loadDoorView(flow: Flow, door: string, drawn: Flow): Promise<DoorView | null> {
  const viewId = flowDoorViewId(flow, door);
  const hit = loading.get(viewId);
  if (hit) return hit;
  const pending = fetch(href(viewId))
    .then((response) => (response.ok ? response.json() : null))
    .then((view: any) => {
      if (!view || typeof view !== "object" || !Array.isArray(view.edges)) return null;
      // Put in the flow's own place in the model, the way a branch's view is:
      // the canvas asks for the flow's view id, and what it gets back is this
      // reading of it.
      const drawnId = flowViewId(flow);
      const put = { ...view, id: drawnId };
      const data: any = (likec4model as any).$data;
      const model = LikeC4Model.create({
        ...data,
        views: { ...data.views, [drawnId]: put },
      } as any) as LikeC4Model.Layouted;
      return {
        model,
        viewId: drawnId,
        pairing: pairEdgesToSteps(
          view.edges.map((edge: any) => String(edge.id)),
          drawnStepIds(drawn, false),
        ),
      };
    })
    .catch(() => null);
  loading.set(viewId, pending);
  return pending;
}
