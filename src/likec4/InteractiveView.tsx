import { useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { DiagramApi } from "likec4/react";
import { ReactLikeC4, isLikeC4ViewId } from "./generated";
import { useTheme } from "../app/theme";
import { Ident } from "../components/Ident";
import { buildHighlightCss } from "./highlight-css";
import type { Size } from "./canvas-viewport";

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
  /**
   * More rules for the same stylesheet — retuned theme tokens, dimmed frames.
   * Anything that paints rather than lays out belongs here rather than in a
   * prop the layout would have to be recomputed for.
   */
  extraCss?: string;
  onNode?: (likec4Id: string) => void;
  onEdge?: (edgeId: string) => void;
  onCanvas?: () => void;
  /**
   * Once the canvas is live, with the diagram's API and the size of the box it
   * was given. The size is measured here because this is the component that
   * owns the box; nothing inside LikeC4 will say how big it was made.
   */
  onReady?: (params: { diagram: DiagramApi; canvas: Size }) => void;
  /**
   * Rendered inside the canvas, where LikeC4's own hooks work. For bridges,
   * not for decoration: anything drawn over the picture belongs beside it.
   */
  children?: ReactNode;
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
        <p className="mono mt-1.5 text-muted">
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
  extraCss = "",
  onNode,
  onEdge,
  onCanvas,
  onReady,
  children,
}: InteractiveViewProps) {
  const { theme } = useTheme();
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Keyed on contents rather than array identity: callers build these lists
  // inline, so comparing by reference would rebuild the sheet every render.
  const nodeKey = highlightNodes.join(" ");
  const edgeKey = highlightEdges.join(" ");
  const css = useMemo(() => {
    const rules = buildHighlightCss(
      nodeKey ? nodeKey.split(" ") : [],
      edgeKey ? edgeKey.split(" ") : [],
    );
    return [extraCss, rules].filter(Boolean).join("\n");
  }, [nodeKey, edgeKey, extraCss]);

  const onInitialized = useCallback(
    ({ diagram }: { diagram: DiagramApi }) => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      onReady?.({ diagram, canvas: { width: box.width, height: box.height } });
    },
    [onReady],
  );

  if (!isLikeC4ViewId(viewId)) return <Missing viewId={viewId} />;

  return (
    <div ref={boxRef} className="h-full w-full bg-canvas">
      <ReactLikeC4
        // Remounting on viewId keeps LikeC4's own walkthrough state from
        // leaking across a filter or variant switch. The variant is in the key
        // for a second reason: it is an initial value inside LikeC4, so the
        // only honest way to change it is to start the canvas again. The
        // selection is deliberately absent: re-keying would re-layout.
        key={`${viewId}:${variant}:${theme}`}
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
        onInitialized={onInitialized}
        style={{ width: "100%", height: "100%" }}
      >
        {css ? <style>{css}</style> : null}
        {children}
      </ReactLikeC4>
    </div>
  );
}
