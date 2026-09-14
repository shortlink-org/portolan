import { useCallback, useEffect, useState } from "react";
import { LikeC4Model } from "@likec4/core/model";
import type { ViewPadding } from "likec4/react";
import { InteractiveView } from "./InteractiveView";
import { catalogIdOf } from "./mapping";
import { viewNodeIds, viewEdgeIds, viewNeighborhood } from "./view-index";
import { neighborhoodCss } from "./neighborhood";
import { useSelectionStore } from "../selection/store";
import { likec4model } from "./generated";
import { layoutContainers } from "./container-layout";
import { DiagramSkeleton } from "../components/DiagramSkeleton";

const layouts = new Map<string, Promise<LikeC4Model.Layouted>>();
function containerModel(viewId: string) {
  let pending = layouts.get(viewId);
  if (!pending) {
    const view = likec4model.findView(viewId)?.$layouted;
    if (!view) return Promise.resolve(likec4model);
    pending = layoutContainers(view).then((layout) => LikeC4Model.create({
      ...likec4model.$data,
      views: { ...likec4model.$data.views, [viewId]: layout },
    }));
    layouts.set(viewId, pending);
  }
  return pending;
}

/**
 * A declared C4 element view. Same renderer as the flows, same generated
 * sources — portolan never draws these itself. Clicking a node selects what it
 * stands for; clicking the canvas clears.
 */
export function C4View({
  viewId,
  height = 320,
  controls = false,
  fitViewPadding,
}: {
  viewId: string;
  height?: number | string;
  /** Zoom controls, useful when a whole estate has to fit on a phone. */
  controls?: boolean;
  /** Space around the fitted model; overview uses a tighter product frame. */
  fitViewPadding?: ViewPadding;
}) {
  const selection = useSelectionStore((s) => s.selection);
  const source = useSelectionStore((s) => s.source);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);

  const onNode = useCallback(
    (likec4Id: string) => select(catalogIdOf(likec4Id), "diagram"),
    [select],
  );
  const onCanvas = useCallback(() => clear("diagram"), [clear]);

  // A selection made here is already marked by LikeC4 itself; one made
  // elsewhere is only marked when this view actually draws it.
  const selectedNode = selection
    ? viewNodeIds(viewId).find((id) => catalogIdOf(id) === selection.id)
    : undefined;
  const marked = selectedNode && source !== "diagram" ? [selectedNode] : [];
  const containers = viewId === "containers" || viewId.startsWith("containers_") || viewId.startsWith("ctx_");
  const [layout, setLayout] = useState<{ id: string; model?: LikeC4Model.Layouted; error?: boolean }>();
  useEffect(() => {
    if (!containers) return;
    let cancelled = false;
    containerModel(viewId).then((model) => { if (!cancelled) setLayout({ id: viewId, model }); }, () => { if (!cancelled) setLayout({ id: viewId, error: true }); });
    return () => { cancelled = true; };
  }, [viewId, containers]);
  const focus = containers && selectedNode ? viewNeighborhood(viewId, selectedNode) : null;

  return (
    <div
      className="relative w-full overflow-hidden rounded-card border border-line bg-canvas shadow-xs"
      style={{ height }}
    >
      {containers && layout?.id !== viewId ? <DiagramSkeleton /> : <InteractiveView
        viewId={viewId}
        controls={controls || containers}
        fitViewPadding={fitViewPadding}
        highlightNodes={containers ? [] : marked}
        extraCss={focus && selectedNode ? neighborhoodCss(focus, viewEdgeIds(viewId), selectedNode) : ""}
        relationshipDetails={containers}
        model={containers ? layout?.model : undefined}
        onNode={onNode}
        onCanvas={onCanvas}
      />}
      {containers && layout?.id === viewId && layout.error ? <p className="absolute bottom-3 left-3 bg-canvas px-3 py-2 text-sm">Using the default layout; container routing is unavailable.</p> : null}
      {focus ? <div className="absolute right-3 bottom-3 flex max-w-[calc(100%-4.5rem)] items-center gap-2 rounded-control border border-line bg-canvas px-3 py-2 shadow-xs">
        <span className="truncate text-sm">Focus: {selection?.id}</span>
        <button type="button" className="tbtn shrink-0" onClick={onCanvas}>Show all</button>
      </div> : null}
    </div>
  );
}
