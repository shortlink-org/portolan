import { useMemo } from "react";
import { ReactLikeC4, isLikeC4ViewId } from "./generated";
import { useTheme } from "../app/theme";
import { Ident } from "../components/Ident";
import { buildHighlightCss } from "./highlight-css";

export interface InteractiveViewProps {
  viewId: string;
  /** Sequence for flows, diagram for element views. */
  variant?: "diagram" | "sequence";
  controls?: boolean;
  walkthrough?: boolean;
  /** LikeC4 element ids to mark; everything else on the canvas is dimmed. */
  highlightNodes?: readonly string[];
  /** LikeC4 edge ids to mark; the other edges are dimmed. */
  highlightEdges?: readonly string[];
  onNode?: (likec4Id: string) => void;
  onEdge?: (edgeId: string) => void;
  onCanvas?: () => void;
}

/**
 * A view id that resolves to nothing. This is not an error the reader caused
 * and not one they can fix from here, so it is stated rather than alarmed
 * about: the id in monospace, because that is the thing to go and look for,
 * and one muted line saying why the box is empty.
 *
 * The box keeps its size. A diagram that fails to exist must not also make the
 * page around it change shape.
 */
function Missing({ viewId }: { viewId: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-prose rounded-card border border-dashed px-4 py-3 text-center border-line-strong">
        <Ident value={viewId} className="text-ink" />
        <p className="meta mt-1.5">
          no such view in the generated bundle — it was renamed, or the bundle
          is older than the model
        </p>
      </div>
    </div>
  );
}

/**
 * The one place portolan embeds a LikeC4 canvas. The packaged LikeC4View gives
 * no way to hear a click, so the lower-level component is used instead and the
 * clicks are forwarded straight to the selection store by the caller.
 */
export function InteractiveView({
  viewId,
  variant = "diagram",
  controls = false,
  walkthrough = false,
  highlightNodes = [],
  highlightEdges = [],
  onNode,
  onEdge,
  onCanvas,
}: InteractiveViewProps) {
  const { theme } = useTheme();

  // Keyed on contents rather than array identity: callers build these lists
  // inline, so comparing by reference would rebuild the sheet every render.
  const nodeKey = highlightNodes.join(" ");
  const edgeKey = highlightEdges.join(" ");
  const css = useMemo(
    () =>
      buildHighlightCss(
        nodeKey ? nodeKey.split(" ") : [],
        edgeKey ? edgeKey.split(" ") : [],
      ),
    [nodeKey, edgeKey],
  );

  if (!isLikeC4ViewId(viewId)) return <Missing viewId={viewId} />;

  return (
    <div className="h-full w-full bg-canvas">
      <ReactLikeC4
        // Remounting on viewId keeps LikeC4's own walkthrough state from
        // leaking across a filter or variant switch. The selection is
        // deliberately absent from this key: re-keying would re-layout.
        key={`${viewId}:${theme}`}
        viewId={viewId}
        dynamicViewVariant={variant}
        colorScheme={theme}
        background="dots"
        controls={controls}
        fitView
        pannable
        zoomable
        enableDynamicViewWalkthrough={walkthrough}
        enableNotes
        enableElementDetails={false}
        enableRelationshipDetails={false}
        enableSearch={false}
        injectFontCss={false}
        onNodeClick={(node) => onNode?.(String(node.id))}
        onEdgeClick={(edge) => onEdge?.(String(edge.id))}
        onCanvasClick={() => onCanvas?.()}
        style={{ width: "100%", height: "100%" }}
      >
        {css ? <style>{css}</style> : null}
      </ReactLikeC4>
    </div>
  );
}
