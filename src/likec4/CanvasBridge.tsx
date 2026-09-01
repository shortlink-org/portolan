// The one wire between the page and the picture.
//
// LikeC4's diagram API is only reachable from inside its own provider, so this
// component renders as a child of the canvas and does nothing else: it draws
// no markup, owns no state of its own, and exists so that the rail outside can
// move the viewport and the toolbar outside can drive the walkthrough without
// either of them knowing that a state machine is involved.
//
// Two directions, and they are deliberately not symmetrical:
//
//   page -> canvas   selecting a step brings its arrow into view. During
//                    playback that becomes a walkthrough step instead, because
//                    there must only ever be one animator and it is LikeC4's.
//   canvas -> page   the walkthrough says which step it is on, and the rail
//                    follows: it highlights, it expands the chapter, it
//                    scrolls. The rail never leads the walkthrough.

import { useEffect, useImperativeHandle, useRef } from "react";
import type { RefObject } from "react";
import { useDiagram, useDiagramContext } from "likec4/react";
import type { DiagramApi } from "likec4/react";
import { boundsOf, focusViewport } from "./canvas-viewport";
import type { Size } from "./canvas-viewport";

/**
 * LikeC4 brands its ids so that one kind cannot be passed where another is
 * wanted. Ours are read straight back out of its own view model, so widening a
 * string into the brand is a formality rather than a claim — and taking the
 * type off the method keeps the formality honest if the brand ever changes.
 */
type EdgeIdArg = Parameters<DiagramApi["centerViewportOnEdge"]>[0];
type StepPathArg = Parameters<DiagramApi["startWalkthrough"]>[0] & string;

/**
 * How big the canvas is right now, measured from the DOM rather than read off
 * React Flow's store.
 *
 * The store's width is kept by a ResizeObserver, which fires a frame late —
 * and selecting a step opens the detail rail, which takes a hundred-odd pixels
 * off the canvas in the very same commit. Aiming a viewport with the width the
 * canvas had a moment ago overshoots by exactly that much, which is how "bring
 * this step into view" ends up putting it a hundred pixels past the edge.
 */
function canvasNode(diagram: DiagramApi): HTMLElement | null {
  const node: unknown = diagram.getContext().xystore.getState().domNode;
  return node instanceof HTMLElement ? node : null;
}

function canvasSize(node: HTMLElement): Size | null {
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.height > 0
    ? { width: box.width, height: box.height }
    : null;
}

export interface CanvasHandle {
  /** Begin playback at the first step. */
  start: () => void;
  step: (delta: 1 | -1) => void;
  stop: () => void;
  /** The escape hatch from readable zoom: show the whole shape. */
  fit: () => void;
}

export function CanvasBridge({
  handle,
  activeEdgeId,
  onWalkthroughEdge,
}: {
  handle: RefObject<CanvasHandle | null>;
  /** The edge the page wants in view, or null when it wants nothing. */
  activeEdgeId: string | null;
  /** The edge playback is on, or null when playback is not running. */
  onWalkthroughEdge: (edgeId: string | null) => void;
}) {
  const diagram = useDiagram();
  /** The last step the page asked the canvas to show, acted on once. */
  const asked = useRef<string | null>(null);
  const walkthroughStep = useDiagramContext(
    (context) => context.activeWalkthrough?.stepId ?? null,
  );

  useImperativeHandle(
    handle,
    () => ({
      start: () => diagram.startWalkthrough(),
      step: (delta) => diagram.walkthroughStep(delta > 0 ? "next" : "prev"),
      stop: () => diagram.stopWalkthrough(),
      fit: () => diagram.fitDiagram(),
    }),
    [diagram],
  );

  useEffect(() => {
    onWalkthroughEdge(walkthroughStep ? String(walkthroughStep) : null);
  }, [walkthroughStep, onWalkthroughEdge]);

  useEffect(() => {
    if (!activeEdgeId) return;

    if (walkthroughStep) {
      // Playback is running, so the only thing worth acting on is a step the
      // reader has just ASKED for — and only once.
      //
      // Acting on the value itself would deadlock the two of them: playback
      // advances to step 3 while the page is still pointing at step 2, the
      // page scrubs it back to 2, playback reports 2, and neither ever gets
      // to finish. The ref is what tells "the reader picked this" apart from
      // "this is what the page was already pointing at".
      if (activeEdgeId === asked.current) return;
      asked.current = activeEdgeId;
      if (String(walkthroughStep) !== activeEdgeId) {
        // A scrub, not a pan: it moves the playhead rather than the camera.
        diagram.walkthroughStep({ step: activeEdgeId as StepPathArg });
      }
      return;
    }
    asked.current = activeEdgeId;

    // Computed here rather than handed to `centerViewportOnEdge`, which caps
    // the zoom at whatever the viewport already had: an arrow wider than the
    // pane then ends up centred and still half off the screen, which is not
    // what "bring step 12 into view" was asked for. The API is still the one
    // moving the viewport; only the destination is ours.
    const bounds = boundsOf(diagram.findDiagramEdge(activeEdgeId)?.points ?? []);
    const node = canvasNode(diagram);
    if (!bounds || !node) {
      diagram.centerViewportOnEdge(activeEdgeId as EdgeIdArg);
      return;
    }

    const aim = (): void => {
      const canvas = canvasSize(node);
      if (!canvas) return;
      diagram.send({
        type: "xyflow.setViewport",
        viewport: focusViewport(bounds, canvas),
      });
    };

    aim();

    // And again whenever the canvas changes size under it. Selecting a step is
    // also what opens the detail rail, which takes its width off the canvas a
    // commit later — so the first aim is at a canvas that is about to stop
    // existing, and without this correction the step lands just off the edge.
    // It keeps the step framed through a divider drag too, which is what the
    // reader dragging the divider while reading a step wants.
    const observer = new ResizeObserver(aim);
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeEdgeId, walkthroughStep, diagram]);

  return null;
}
