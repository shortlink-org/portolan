import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Link } from "react-router";
import { LikeC4Model } from "@likec4/core/model";
import type { ViewPadding } from "likec4/react";
import { InteractiveView } from "./InteractiveView";
import { catalogIdOf } from "./mapping";
import { viewNodeIds, viewEdgeIds, viewNeighborhood } from "./view-index";
import { neighborhoodCss } from "./neighborhood";
import { useSelectionStore } from "../selection/store";
import { likec4model } from "./bundle";
import { layoutContainers } from "./container-layout";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { FullscreenButton } from "../components/FullscreenButton";
import { LegendButton, LegendPanel, useLegend } from "./ViewLegend";
import { viewLegend } from "./legend";
import { ViewTitle } from "./ViewTitle";
import { evidenceForEdge } from "./edge-evidence";
import type { EvidenceModel } from "./edge-evidence";
import { boundaryEdgeIds } from "./boundaries";
import { filteredViewId, safeId } from "./ids";
import type { DiagramFilterKind } from "./ids";
import { catalog, index } from "../data";
import { allRepos } from "../catalog";
import { pathForId } from "../app/canonical";
import { rpcMethodPath } from "../routes";
import { sourceLocation } from "../lib/source-link";
import { SourcePreviewLink } from "../components/SourcePreview";

function CatalogEvidenceLink({ id }: { id: string }) {
  const to = pathForId(index, id);
  return to ? (
    <Link to={to} data-peek={id} className="rounded-control text-accent hover:underline">
      {id}
    </Link>
  ) : <span>{id}</span>;
}

function OperationEvidenceLink({ id }: { id: string }) {
  const to = rpcMethodPath(id);
  return to ? (
    <Link to={to} className="break-all rounded-control text-accent hover:underline">
      {id}
    </Link>
  ) : <span className="break-all">{id}</span>;
}

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
  boundaryContext,
  filterable = false,
}: {
  viewId: string;
  height?: number | string;
  /** Zoom controls, useful when a whole estate has to fit on a phone. */
  controls?: boolean;
  /** Space around the fitted model; overview uses a tighter product frame. */
  fitViewPadding?: ViewPadding;
  /** Offer paint-only highlighting for every boundary, or for one context. */
  boundaryContext?: true | string;
  /** Let the legend swap among generated, re-laid-out L2 variants. */
  filterable?: boolean;
}) {
  const selection = useSelectionStore((s) => s.selection);
  const source = useSelectionStore((s) => s.source);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);

  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [highlightBoundaries, setHighlightBoundaries] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<Set<DiagramFilterKind>>(new Set());
  const shownViewId = filterable ? filteredViewId(viewId, [...hiddenKinds]) : viewId;

  const onNode = useCallback(
    (likec4Id: string) => {
      setSelectedEdge(null);
      select(catalogIdOf(likec4Id), "diagram");
    },
    [select],
  );
  const onCanvas = useCallback(() => {
    setSelectedEdge(null);
    clear("diagram");
  }, [clear]);

  // A selection made here is already marked by LikeC4 itself; one made
  // elsewhere is only marked when this view actually draws it.
  const selectedNode = selection
    ? viewNodeIds(shownViewId).find((id) => catalogIdOf(id) === selection.id)
    : undefined;
  const marked = selectedNode && source !== "diagram" ? [selectedNode] : [];
  const containers = shownViewId === "containers" || shownViewId.startsWith("containers_") ||
    (shownViewId.startsWith("ctx_") && !shownViewId.endsWith("_landscape"));
  const [layout, setLayout] = useState<{ id: string; model?: LikeC4Model.Layouted; error?: boolean }>();
  useEffect(() => {
    if (!containers) return;
    let cancelled = false;
    containerModel(shownViewId).then((model) => { if (!cancelled) setLayout({ id: shownViewId, model }); }, () => { if (!cancelled) setLayout({ id: shownViewId, error: true }); });
    return () => { cancelled = true; };
  }, [shownViewId, containers]);
  useEffect(() => setSelectedEdge(null), [shownViewId]);
  const focus = containers && selectedNode ? viewNeighborhood(shownViewId, selectedNode) : null;
  const legend = viewLegend(viewId);
  const key = useLegend();
  const activeModel = containers ? layout?.model : likec4model;
  const crossingEdges = useMemo(() => {
    if (!boundaryContext || !activeModel) return [];
    const view = activeModel.findView(shownViewId)?.$layouted;
    return view
      ? boundaryEdgeIds(
          view.nodes,
          view.edges,
          boundaryContext === true ? undefined : safeId(boundaryContext),
        )
      : [];
  }, [activeModel, boundaryContext, shownViewId]);
  const edgeEvidence =
    selectedEdge && activeModel
      ? evidenceForEdge(activeModel as unknown as EvidenceModel, shownViewId, selectedEdge)
      : null;

  return (
    <div
      data-fullscreen
      className="@container relative w-full overflow-hidden rounded-card border border-line bg-canvas shadow-xs"
      style={{ height }}
    >
      {containers && layout?.id !== shownViewId ? <DiagramSkeleton /> : <InteractiveView
        viewId={shownViewId}
        controls={controls || containers}
        fitViewPadding={fitViewPadding}
        highlightNodes={containers ? [] : marked}
        highlightEdges={selectedEdge ? [selectedEdge] : highlightBoundaries ? crossingEdges : []}
        extraCss={focus && selectedNode ? neighborhoodCss(focus, viewEdgeIds(shownViewId), selectedNode) : ""}
        // Every picture folds relations into summaries now, so every one
        // keeps the methods behind a summary one click away.
        relationshipDetails={false}
        model={containers ? layout?.model : undefined}
        onNode={onNode}
        onEdge={(edgeId) => {
          clear("diagram");
          setSelectedEdge(edgeId);
        }}
        onCanvas={onCanvas}
      />}
      {containers && layout?.id === shownViewId && layout.error ? <p className="absolute bottom-3 left-3 bg-canvas px-3 py-2 text-sm">Using the default layout; container routing is unavailable.</p> : null}
      {/* LikeC4 refits on its own when the box changes size, so the button
          needs no hook into the diagram. With LikeC4's own controls on, a
          canvas narrower than its `sm` container (24rem) turns their panel
          into a full-width bar along the top edge, and this group would sit
          under it; there it steps down below the bar. */}
      <div className={`seg seg-float absolute top-3 right-3 z-10 ${controls || containers ? "@max-sm:top-11" : ""}`}>
        {crossingEdges.length > 0 ? (
          <button
            type="button"
            aria-pressed={highlightBoundaries}
            className={highlightBoundaries ? "is-on" : ""}
            title="Highlight communication that crosses context boundaries"
            onClick={() => setHighlightBoundaries((shown) => !shown)}
          >
            Crossings
          </button>
        ) : null}
        {legend ? <LegendButton open={key.open} controls={key.id} onToggle={key.toggle} /> : null}
        <FullscreenButton />
      </div>
      {legend && key.open ? <LegendPanel
        id={key.id}
        legend={legend}
        onClose={key.close}
        hiddenKinds={filterable ? hiddenKinds : undefined}
        onToggleKind={filterable ? (kind) => setHiddenKinds((hidden) => {
          const next = new Set(hidden);
          if (!next.delete(kind)) next.add(kind);
          return next;
        }) : undefined}
      /> : null}
      <ViewTitle viewId={shownViewId} />
      {edgeEvidence ? (
        <aside
          aria-label="Relationship evidence"
          className="absolute inset-x-3 bottom-3 z-20 max-h-[58%] overflow-y-auto rounded-card border border-line bg-canvas p-3 shadow-md"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">Why this is connected</div>
              <div className="mono mt-0.5 truncate text-xs text-muted">
                <CatalogEvidenceLink id={catalogIdOf(edgeEvidence.source)} />
                <span aria-hidden> → </span>
                <CatalogEvidenceLink id={catalogIdOf(edgeEvidence.target)} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEdge(null)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface hover:text-ink"
              aria-label="Close relationship evidence"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
          {edgeEvidence.relations.length > 0 ? (
            <div className="mt-2 grid gap-2">
              {edgeEvidence.relations.map((relation) => (
                <div key={relation.id} className="rounded-control bg-surface px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-ink">{relation.title}</span>
                    {relation.technology ? <span className="chip">{relation.technology}</span> : null}
                    {relation.status ? <span className="chip">{relation.status}</span> : null}
                  </div>
                  {relation.call ? (
                    <div className="mono mt-1 flex flex-wrap items-baseline gap-x-1 text-xs text-muted">
                      <OperationEvidenceLink id={relation.call.id} />
                      {relation.call.source ? <>
                        <span aria-hidden>·</span>
                        <SourcePreviewLink
                          location={sourceLocation(
                            relation.call.source,
                            index.serviceById.get(catalogIdOf(relation.source)),
                            allRepos(catalog),
                          )}
                          className="min-w-0 break-all text-accent hover:underline"
                        >
                          {relation.call.source}
                        </SourcePreviewLink>
                      </> : null}
                    </div>
                  ) : relation.detail ? (
                    <div className="mono mt-1 break-all text-xs text-muted">{relation.detail}</div>
                  ) : (
                    <div className="mt-1 text-xs text-muted">No source detail was recorded for this relation.</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              The generated model records the connection, but no individual source relation is attached to this edge.
            </p>
          )}
        </aside>
      ) : null}
      {focus ? <div className="absolute right-3 bottom-3 flex max-w-[calc(100%-4.5rem)] items-center gap-2 rounded-control border border-line bg-canvas px-3 py-2 shadow-xs">
        <span className="truncate text-sm">Focus: {selection?.id}</span>
        <button type="button" className="tbtn shrink-0" onClick={onCanvas}>Show all</button>
      </div> : null}
    </div>
  );
}
