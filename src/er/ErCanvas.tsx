// The ER canvas: one store, its tables and views, the keys between them and the
// lineage through them.
//
// Everything structural was decided in spec.ts and layout.ts. What is left here
// is the reading aids — hovering a column to see where it points and where its
// value came from, searching for a table by a column nobody remembers the table
// for — and the wiring into the app's one selection, so a table clicked here
// fills the same detail panel an event clicked on the dependency graph does.
//
// Hovering a column lights the whole lineage chain, not just the neighbouring
// hop. A copy of a copy is still a copy, and the question a reader has when
// they hover a column of a report is "where did this ORIGINALLY come from",
// which one hop cannot answer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Columns3, Download, Eye, Maximize2, Search, Waypoints } from "lucide-react";
import type { Store } from "../catalog";
import { storeViews } from "../catalog";
import { index } from "../data";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { useSelectionStore } from "../selection/store";
import { TableNodeCard } from "./TableNode";
import { ViewNodeCard } from "./ViewNode";
import type { ErFlowNode } from "./RelationCard";
import { ErMarkers, MARKER_FLOW, MARKER_MANY, MARKER_ONE } from "./markers";
import { layoutEr } from "./layout";
import { lineageChain } from "./lineage";
import type { LineageMaps } from "./lineage";
import { erSpec, matchingNodes } from "./spec";
import type { ColumnMode, ErSpec } from "./spec";
import { toPng } from "html-to-image";

/** Stable across renders: React Flow re-mounts every node when this changes. */
const erNodeTypes = { erTable: TableNodeCard, erView: ViewNodeCard };

const DIM = 0.25;

/** The catalog's lineage graph, walked on hover. Built once, with the index. */
const LINEAGE: LineageMaps = {
  from: index.lineageFrom,
  into: index.lineageInto,
};

interface CanvasProps {
  store: Store;
  /** A store this service reads but does not own. */
  ghost?: boolean;
  /** Height of the canvas box. The store page passes "100%". */
  height?: number | string;
}

function Canvas({ store, ghost = false, height = 340 }: CanvasProps) {
  const [mode, setMode] = useState<ColumnMode>("keys");
  const [term, setTerm] = useState("");
  const [showViews, setShowViews] = useState(true);
  const [showLineage, setShowLineage] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const wrapper = useRef<HTMLDivElement | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [layout, setLayout] = useState<{
    positions: Record<string, { x: number; y: number }>;
    ready: boolean;
  }>({ positions: {}, ready: false });

  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);
  const selectionId = useSelectionStore((s) => s.selection?.id ?? null);

  const spec: ErSpec = useMemo(
    () =>
      erSpec(index, store, {
        mode,
        expanded,
        ghost,
        views: showViews,
        lineage: showLineage,
      }),
    [store, mode, expanded, ghost, showViews, showLineage],
  );

  const matched = useMemo(() => matchingNodes(spec, term), [spec, term]);

  useEffect(() => {
    let cancelled = false;
    setLayout((prev) => ({ ...prev, ready: false }));
    void layoutEr(spec).then((result) => {
      if (!cancelled) setLayout({ positions: result.positions, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, [spec]);

  // Which columns need an anchor, per table. A column with no relationship
  // gets no handle: React Flow measures every handle it is given, and a wide
  // schema has hundreds of columns that will never be an end of anything.
  const anchors = useMemo(() => {
    const out = new Map<string, Set<string>>();
    const add = (tableId: string, column: string) => {
      const set = out.get(tableId) ?? new Set<string>();
      set.add(column);
      out.set(tableId, set);
    };
    for (const edge of spec.edges) {
      if (edge.fromColumn) add(edge.from, edge.fromColumn);
      if (edge.toColumn) add(edge.to, edge.toColumn);
    }
    return out;
  }, [spec]);

  /** Everything lit right now, from whichever end the pointer is on. */
  const { litColumns, litEdges } = useMemo(() => {
    const columns = new Set<string>();
    const edges = new Set<string>();
    /** Both ends of an edge, when it has column ends at all. */
    const ends = (edge: ErSpec["edges"][number]): string[] =>
      edge.fromColumn && edge.toColumn
        ? [`${edge.from}.${edge.fromColumn}`, `${edge.to}.${edge.toColumn}`]
        : [];

    if (hoverColumn) {
      columns.add(hoverColumn);
      // Lineage first, and transitively: the chain is the answer, one hop is
      // an anecdote. Only edges this canvas actually drew are lit — a chain
      // that leaves the store is read in the panel, not here.
      if (showLineage) {
        const chain = lineageChain(LINEAGE, hoverColumn);
        for (const id of chain.columns) columns.add(id);
        for (const id of chain.edges) edges.add(id);
      }
      for (const edge of spec.edges) {
        const [from, to] = ends(edge);
        if (!from || !to) continue;
        if (from === hoverColumn || to === hoverColumn) {
          edges.add(edge.id);
          columns.add(from);
          columns.add(to);
        }
      }
    } else if (hoverEdge) {
      const edge = spec.edges.find((e) => e.id === hoverEdge);
      if (edge) {
        edges.add(edge.id);
        for (const end of ends(edge)) columns.add(end);
      }
    }
    return { litColumns: columns, litEdges: edges };
  }, [hoverColumn, hoverEdge, spec, showLineage]);

  // A canvas on the service page is mounted inside a tab that is not on screen
  // yet, so its first fit happens against a box of zero width and lands
  // nowhere. Refitting when the box actually gets a size is what makes the
  // schema visible the first time the tab is opened, and only a CHANGE in
  // width refits, so panning survives a re-render.
  const flow = useReactFlow();
  useEffect(() => {
    const box = wrapper.current;
    if (!box) return;
    let last = box.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = box.clientWidth;
      if (width === last) return;
      last = width;
      if (width > 0 && layout.ready) flow.fitView({ padding: 0.1 });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [flow, layout.ready]);

  const onToggle = useCallback((tableId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  }, []);

  const onColumnClick = useCallback(
    (columnId: string) => select(columnId, "diagram"),
    [select],
  );

  const selectedColumn = useMemo(() => {
    const id = selectionId ?? "";
    return index.columnById.has(id) || index.viewColumnById.has(id)
      ? selectionId
      : null;
  }, [selectionId]);

  const nodes: ErFlowNode[] = useMemo(
    () =>
      spec.nodes.map((node) => ({
        id: node.id,
        type: node.kind === "view" ? ("erView" as const) : ("erTable" as const),
        position: layout.positions[node.id] ?? { x: 0, y: 0 },
        width: node.width,
        height: node.height,
        initialWidth: node.width,
        initialHeight: node.height,
        draggable: false,
        connectable: false,
        selected: node.id === selectionId,
        data: {
          node,
          anchors: anchors.get(node.id) ?? EMPTY,
          matched: matched.has(node.id),
          dimmed: matched.size > 0 && !matched.has(node.id),
          litColumns,
          selectedColumn,
          onToggle,
          onColumnEnter: setHoverColumn,
          onColumnClick,
        },
      })),
    [
      spec,
      layout.positions,
      anchors,
      matched,
      litColumns,
      selectedColumn,
      selectionId,
      onToggle,
      onColumnClick,
    ],
  );

  const edges: Edge[] = useMemo(
    () =>
      spec.edges.map((edge) => {
        // Which side each end uses is a question about where the two cards
        // actually landed, so it is answered here and not in the spec.
        const from = layout.positions[edge.from]?.x ?? 0;
        const to = layout.positions[edge.to]?.x ?? 0;
        const targetIsLeft = to <= from;
        const lit = litEdges.has(edge.id);
        const lineage = edge.kind === "lineage";
        const colour = lit ? "var(--accent)" : "var(--border-strong)";
        // A lineage edge that names no column joins the two cards rather than
        // two rows: the catalog said "this view reads that table" and no more,
        // and inventing a row for it would be drawing a fact nobody stated.
        const source =
          edge.fromColumn === null
            ? "table-source"
            : `${targetIsLeft ? "l" : "r"}:${edge.fromColumn}`;
        const target =
          edge.toColumn === null
            ? "table"
            : `${targetIsLeft ? "tr" : "tl"}:${edge.toColumn}`;
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: source,
          targetHandle: target,
          type: "smoothstep",
          ...(edge.onDelete ? { label: `on delete ${edge.onDelete}` } : {}),
          labelStyle: {
            fill: "var(--fg-muted)",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
          },
          labelBgStyle: { fill: "var(--bg)" },
          labelBgPadding: [3, 1] as [number, number],
          labelShowBg: true,
          style: {
            stroke: colour,
            strokeWidth: lit ? 1.8 : 1,
            opacity: litEdges.size > 0 && !lit ? DIM : 1,
            // Dashed for lineage, solid for a key: one is a copy the database
            // performs, the other a constraint it enforces, and a reader
            // should be able to tell which without following the line.
            ...(lineage ? { strokeDasharray: "3 3" } : {}),
          },
          // React Flow builds the url(#…) wrapper itself; passing one here
          // produces url(#url(#…)) and no marker at all.
          ...(lineage
            ? { markerEnd: MARKER_FLOW }
            : { markerStart: MARKER_MANY, markerEnd: MARKER_ONE }),
          zIndex: lit ? 10 : 0,
        };
      }),
    [spec, layout.positions, litEdges],
  );

  const fitKey = layout.ready ? `fit-${nodes.length}-${mode}` : "pending";
  const views = storeViews(store).length;

  return (
    /* The toolbar is a row above the canvas, not a panel floating over it: a
       control that covers the top-left table is a control that hides the one
       elk put first. */
    <div
      ref={wrapper}
      className="flex w-full flex-col overflow-hidden rounded-card border border-line"
      style={{ height }}
    >
      <ErMarkers />
      <Toolbar
        term={term}
        onTerm={setTerm}
        mode={mode}
        onMode={setMode}
        hits={matched.size}
        views={views}
        showViews={showViews}
        onShowViews={setShowViews}
        showLineage={showLineage}
        onShowLineage={setShowLineage}
        wrapper={wrapper}
        name={store.id}
      />
      <div className="relative min-h-0 flex-1">
        {layout.ready ? null : <DiagramSkeleton />}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={erNodeTypes}
          onNodeClick={(_, node) => select(node.id, "diagram")}
          onPaneClick={() => clear("diagram")}
          onEdgeMouseEnter={(_, edge) => setHoverEdge(edge.id)}
          onEdgeMouseLeave={() => setHoverEdge(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.1}
          maxZoom={2}
          key={fitKey}
        >
          <Background gap={22} size={1} color="var(--border)" />
        </ReactFlow>
      </div>
    </div>
  );
}

const EMPTY: ReadonlySet<string> = new Set();

function Toolbar({
  term,
  onTerm,
  mode,
  onMode,
  hits,
  views,
  showViews,
  onShowViews,
  showLineage,
  onShowLineage,
  wrapper,
  name,
}: {
  term: string;
  onTerm: (value: string) => void;
  mode: ColumnMode;
  onMode: (value: ColumnMode) => void;
  hits: number;
  /** How many views this store has; with none, the toggle is not a choice. */
  views: number;
  showViews: boolean;
  onShowViews: (value: boolean) => void;
  showLineage: boolean;
  onShowLineage: (value: boolean) => void;
  wrapper: React.RefObject<HTMLDivElement | null>;
  name: string;
}) {
  const flow = useReactFlow();
  const [saving, setSaving] = useState(false);

  const exportPng = async (): Promise<void> => {
    const viewport = wrapper.current?.querySelector<HTMLElement>(
      ".react-flow__viewport",
    );
    if (!viewport) return;
    setSaving(true);
    try {
      // The viewport is captured at its own size rather than the box's, so the
      // file holds the whole schema however far it has been panned.
      const url = await toPng(viewport, {
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        pixelRatio: 2,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.png`;
      a.click();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5 border-line bg-surface">
      <label className="flex items-center gap-1.5 rounded-control border px-2 py-1 border-line bg-canvas">
        <Search size={12} aria-hidden className="text-muted" />
        <input
          value={term}
          onChange={(e) => onTerm(e.target.value)}
          placeholder="find a table or column"
          spellCheck={false}
          aria-label="Find a table or column"
          className="mono w-44 bg-transparent outline-none placeholder:text-muted"
        />
        {term ? (
          <span className="mono tnum shrink-0 text-muted">{hits}</span>
        ) : null}
      </label>

      <div className="seg bg-canvas" role="group" aria-label="Columns shown">
        <button
          type="button"
          onClick={() => onMode("keys")}
          aria-pressed={mode === "keys"}
          className={mode === "keys" ? "is-on" : ""}
          title="Show keys only"
        >
          keys
        </button>
        <button
          type="button"
          onClick={() => onMode("all")}
          aria-pressed={mode === "all"}
          className={mode === "all" ? "is-on" : ""}
          title="Show every column"
        >
          <Columns3 size={11} aria-hidden className="inline" /> all
        </button>
      </div>

      {/* Two toggles rather than one: a reader who wants the tables alone and a
          reader who wants the views without the web of lines that joins them
          are asking different questions, and answering both with one switch
          means one of them has to look at a picture they did not ask for. */}
      {views > 0 ? (
        <button
          type="button"
          onClick={() => onShowViews(!showViews)}
          aria-pressed={showViews}
          title={`${showViews ? "Hide" : "Show"} the ${views} view${views === 1 ? "" : "s"} in this store`}
          className={`mono flex items-center gap-1 rounded-control border px-1.5 py-1 border-line bg-canvas ${
            showViews ? "text-ink" : "text-muted"
          }`}
        >
          <Eye size={11} aria-hidden />
          <span className="tnum">{views}</span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onShowLineage(!showLineage)}
        aria-pressed={showLineage}
        title={`${showLineage ? "Hide" : "Show"} where each value is copied from`}
        aria-label="Lineage"
        className={`rounded-control border p-1.5 border-line bg-canvas ${
          showLineage ? "text-ink" : "text-muted"
        }`}
      >
        <Waypoints size={12} aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => flow.fitView({ padding: 0.1 })}
        title="Fit to view"
        aria-label="Fit to view"
        className="rounded-control border p-1.5 border-line bg-canvas text-muted hover:text-ink"
      >
        <Maximize2 size={12} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => void exportPng()}
        disabled={saving}
        title="Export PNG"
        aria-label="Export PNG"
        className="rounded-control border p-1.5 border-line bg-canvas text-muted hover:text-ink disabled:opacity-50"
      >
        <Download size={12} aria-hidden />
      </button>
    </div>
  );
}

export function ErCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
