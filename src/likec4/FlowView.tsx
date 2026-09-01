import { useCallback, useMemo } from "react";
import type { RefObject } from "react";
import type { DiagramApi } from "likec4/react";
import type { Flow } from "../catalog";
import { InteractiveView } from "./InteractiveView";
import { CanvasBridge } from "./CanvasBridge";
import type { CanvasHandle } from "./CanvasBridge";
import { flowCrossViewId, flowViewId, fqn } from "./ids";
import { catalogIdOf } from "./mapping";
import { flowPairing, viewBounds, viewEdgeIds, viewHasNode } from "./view-index";
import { offPathFrameIds } from "./flow-edges";
import {
  buildFrameCss,
  buildOffPathCss,
  buildWalkthroughCss,
} from "./frame-theme";
import { centredViewport, readableViewport } from "./canvas-viewport";
import type { Size } from "./canvas-viewport";
import { flowStepId } from "../selection/model";
import { useSelectionStore } from "../selection/store";

/** A stable empty list, so `useMemo` below is not defeated by a fresh `[]`. */
const NOTHING: readonly string[] = [];

/**
 * The flow picture. LikeC4 owns it end to end: the sequence is declared in
 * likec4/views.c4, generated from the same catalog.json the rest of the page
 * reads. Portolan draws nothing here itself — it says which steps are lit,
 * where to look, and what colour the frames should be, and hears which step
 * was clicked and which one playback is on.
 */
export function FlowView({
  flow,
  crossOnly,
  variant,
  litSteps = [],
  pathSteps = null,
  focusStep = null,
  canvas,
  onWalkthroughStep,
}: {
  flow: Flow;
  crossOnly: boolean;
  variant: "diagram" | "sequence";
  /** Catalog step ids to mark; the rest of the sequence is dimmed. */
  litSteps?: readonly string[];
  /**
   * Steps of the path being read, when one is chosen. The picture keeps drawing
   * every branch — the alt frame is the point of it — but the branches not
   * taken recede, so what is on screen matches what the rail lists.
   */
  pathSteps?: readonly string[] | null;
  /** The step the canvas should bring into view, when the rail asks for one. */
  focusStep?: string | null;
  canvas: RefObject<CanvasHandle | null>;
  /** The step playback is on, in catalog terms, or null when it is stopped. */
  onWalkthroughStep: (stepId: string | null) => void;
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

  const onCanvasClick = useCallback(() => clear("diagram"), [clear]);

  const onWalkthroughEdge = useCallback(
    (edgeId: string | null) => {
      onWalkthroughStep(edgeId ? (pairing.stepOf.get(edgeId) ?? null) : null);
    },
    [pairing, onWalkthroughStep],
  );

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

  // Frames go with their steps. Only a chosen PATH greys frames — a selection
  // is one step and greying every frame around it would leave the reader
  // looking at a single arrow with no idea what it runs under.
  const extraCss = useMemo(() => {
    const theme = [buildFrameCss(), buildWalkthroughCss()].join("\n");
    if (!pathSteps) return theme;
    const onPath = new Set(
      pathSteps
        .map((stepId) => pairing.edgeOf.get(stepId))
        .filter((id): id is string => id !== undefined),
    );
    const frames = offPathFrameIds(viewEdgeIds(viewId), onPath);
    return [theme, buildOffPathCss(frames)].filter(Boolean).join("\n");
  }, [pathSteps, pairing, viewId]);

  // Lanes are marked only for a selection made somewhere else, and only when
  // this variant of the view actually has that lane.
  const highlightNodes =
    selection &&
    source !== "diagram" &&
    (selection.kind === "service" || selection.kind === "unknown") &&
    viewHasNode(viewId, fqn(selection.id))
      ? [fqn(selection.id)]
      : [];

  /**
   * The opening viewport, applied once the canvas is live.
   *
   * Both variants open at the size their labels were drawn for — fitting a
   * flow of this length puts every label at four pixels, which shows that it
   * is long and nothing else. What differs is where they open. A sequence has
   * a beginning: its top-left corner is step one. A diagram does not — it
   * folds forty-five steps onto nine boxes and has no reading order — so it
   * opens centred on the arrow that draws step one instead.
   *
   * The second `send` is the point of the first one. LikeC4 refits on resize
   * unless the viewport was moved by hand, and the page resizes the canvas
   * itself whenever the rail is dragged — so a viewport set programmatically
   * and left unclaimed would be thrown away the first time the reader touched
   * the divider. Claiming it says: this is where the reader is looking.
   */
  const onReady = useCallback(
    ({ diagram, canvas: box }: { diagram: DiagramApi; canvas: Size }) => {
      if (box.width === 0) return;

      let viewport;
      if (variant === "sequence") {
        const bounds = viewBounds(viewId, variant);
        if (!bounds) return;
        viewport = readableViewport(bounds, box);
      } else {
        const firstEdge = viewEdgeIds(viewId)[0];
        const start = firstEdge
          ? diagram.findDiagramEdge(firstEdge)?.points[0]
          : undefined;
        // No geometry to aim at is not worth a guess: LikeC4's own fit is
        // already on screen, and leaving it beats jumping somewhere arbitrary.
        if (!start) return;
        viewport = centredViewport({ x: start[0], y: start[1] }, box);
      }

      diagram.send({ type: "xyflow.setViewport", viewport, duration: 0 });
      diagram.send({ type: "xyflow.viewportMoved", viewport, manually: true });
    },
    [viewId, variant],
  );

  return (
    <InteractiveView
      viewId={viewId}
      variant={variant}
      // LikeC4's own controls panel carries a toolbar and a wordmark. The page
      // already has one toolbar, and two is one too many, so the panel is off
      // and every control it held has a place in ours.
      controls={false}
      walkthrough
      highlightNodes={highlightNodes}
      highlightEdges={highlightEdges}
      extraCss={extraCss}
      onNode={onNode}
      onEdge={onEdge}
      onCanvas={onCanvasClick}
      onReady={onReady}
    >
      <CanvasBridge
        handle={canvas}
        activeEdgeId={
          focusStep ? (pairing.edgeOf.get(focusStep) ?? null) : null
        }
        onWalkthroughEdge={onWalkthroughEdge}
      />
    </InteractiveView>
  );
}
