import { useCallback, useMemo } from "react";
import type { Flow } from "../catalog";
import { InteractiveView } from "./InteractiveView";
import { flowCrossViewId, flowViewId, fqn } from "./ids";
import { catalogIdOf } from "./mapping";
import { flowPairing, viewHasNode } from "./view-index";
import { flowStepId } from "../selection/model";
import { useSelectionStore } from "../selection/store";

/** A stable empty list, so `useMemo` below is not defeated by a fresh `[]`. */
const NOTHING: readonly string[] = [];

/**
 * The flow picture. LikeC4 owns it end to end: the sequence is declared in
 * likec4/views.c4, generated from the same catalog.json the rest of the page
 * reads. Portolan draws nothing here itself — it only says which steps are
 * lit, and hears which one was clicked.
 */
export function FlowView({
  flow,
  crossOnly,
  litSteps = [],
  pathSteps = null,
}: {
  flow: Flow;
  crossOnly: boolean;
  /** Catalog step ids to mark; the rest of the sequence is dimmed. */
  litSteps?: readonly string[];
  /**
   * Steps of the path being read, when one is chosen. The picture keeps drawing
   * every branch — the alt frame is the point of it — but the branches not
   * taken recede, so what is on screen matches what the rail lists.
   */
  pathSteps?: readonly string[] | null;
}) {
  const viewId = crossOnly ? flowCrossViewId(flow) : flowViewId(flow);
  const pairing = flowPairing(flow, crossOnly);

  const selection = useSelectionStore((s) => s.selection);
  const source = useSelectionStore((s) => s.source);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);

  const onNode = useCallback(
    (likec4Id: string) => select(catalogIdOf(likec4Id), "diagram"),
    [select],
  );

  // A clicked arrow is a step, not a relation: the sequence is what this view
  // is about, so the click resolves through the edge-to-step pairing.
  const onEdge = useCallback(
    (edgeId: string) => {
      const stepId = pairing.stepOf.get(edgeId);
      if (stepId) select(flowStepId(flow.slug, stepId), "diagram");
    },
    [pairing, flow.slug, select],
  );

  const onCanvas = useCallback(() => clear("diagram"), [clear]);

  // A selection is narrower than a path, so it wins: choosing a path lifts the
  // branch you are reading, and clicking a step then narrows to that one step.
  const marked = litSteps.length > 0 ? litSteps : (pathSteps ?? NOTHING);

  const highlightEdges = useMemo(
    () =>
      marked
        .map((stepId) => pairing.edgeOf.get(stepId))
        .filter((id): id is string => id !== undefined),
    [marked, pairing],
  );

  // Lanes are marked only for a selection made somewhere else, and only when
  // this variant of the view actually has that lane.
  const highlightNodes =
    selection &&
    source !== "diagram" &&
    (selection.kind === "service" || selection.kind === "unknown") &&
    viewHasNode(viewId, fqn(selection.id))
      ? [fqn(selection.id)]
      : [];

  return (
    <InteractiveView
      viewId={viewId}
      // Sequence is the honest default for a flow; LikeC4's own toolbar
      // switches to the diagram variant, so portolan does not duplicate that.
      variant="sequence"
      controls
      walkthrough
      highlightNodes={highlightNodes}
      highlightEdges={highlightEdges}
      onNode={onNode}
      onEdge={onEdge}
      onCanvas={onCanvas}
    />
  );
}
