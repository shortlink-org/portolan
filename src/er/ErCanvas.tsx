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
import { Columns3, Eye, FileCode2, ImageDown, LayoutGrid, Maximize2, Search, Waypoints, Workflow } from "lucide-react";
import type { Store } from "../catalog";
import { storeViews } from "../catalog";
import { index } from "../data";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { useSelectionStore } from "../selection/store";
import { TableNodeCard } from "./TableNode";
import { ViewNodeCard } from "./ViewNode";
import { GroupNodeCard } from "./GroupNode";
import type { ErGroupNode } from "./GroupNode";
import type { ErFlowNode } from "./RelationCard";
import { EDGE_W, EDGE_W_LIT } from "../graph/theme";
import { ErMarkers, MARKER_FLOW, MARKER_MANY, MARKER_ONE } from "./markers";
import { canGroup, layoutEr } from "./layout";
import type { ErGroupFrame } from "./layout";
import { lineageChain } from "./lineage";
import type { LineageMaps } from "./lineage";
import { erSpec, matchingNodes } from "./spec";
import type { ColumnMode, ErSpec } from "./spec";
import { useToastStore } from "../app/toast";
import { saveCanvasImage, viewportOf } from "../lib/export-canvas";
import type { ImageKind } from "../lib/export-canvas";

/** Stable across renders: React Flow re-mounts every node when this changes. */
const erNodeTypes = { erTable: TableNodeCard, erView: ViewNodeCard, erGroup: GroupNodeCard };

/** One flow, roots first; or the cards by model group, the groups packed. */
type Arrangement = "flow" | "groups";

const DIM = 0.25;

/** More hits than this is most of a schema; framing them is framing everything. */
const SEARCH_FRAME_LIMIT = 30;

/** The catalog's lineage graph, walked on hover. Built once, with the index. */
const LINEAGE: LineageMaps = {
  from: index.lineageFrom,
  into: index.lineageInto,
};

/**
 * The height a canvas gets when it is one section of a longer page rather than
 * the page itself - a share of the window, not a fixed box. 360px was 360px on
 * a laptop and on a 27" display, which left the bottom half of the second one
 * empty and gave an expanded table nowhere to grow into. Floored so a short
 * window keeps a canvas worth drawing, capped so a tall one does not turn a
 * service page into a single diagram.
 *
 * It does not make the schema any bigger. The opening fit is bound by the
 * column's WIDTH, so a taller box buys room to pan and to expand into, not a
 * larger scale - the store's own page, where the canvas has the whole pane, is
 * where a schema is read at 1:1.
 */
const CANVAS_SECTION_HEIGHT = "clamp(360px, 62vh, 720px)";

interface CanvasProps {
  store: Store;
  /** A store this service reads but does not own. */
  ghost?: boolean;
  /** Height of the canvas box. The store page passes "100%". */
  height?: number | string;
}

function Canvas({
  store,
  ghost = false,
  height = CANVAS_SECTION_HEIGHT,
}: CanvasProps) {
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
    groups: ErGroupFrame[];
    ready: boolean;
  }>({ positions: {}, groups: [], ready: false });
  // Null until the reader chooses: a schema big enough is grouped, the rest
  // flow, and the toggle only appears where the choice exists.
  const [chosen, setChosen] = useState<Arrangement | null>(null);

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
  const matchedIds = useMemo(() => [...matched], [matched]);
  // Which match the reader is standing on: -1 is "all of them", what typing
  // gives; Enter steps through them one at a time.
  const [cursor, setCursor] = useState(-1);
  useEffect(() => setCursor(-1), [term]);

  const groupable = useMemo(() => canGroup(spec), [spec]);
  const arrangement: Arrangement = groupable ? (chosen ?? "groups") : "flow";

  useEffect(() => {
    let cancelled = false;
    setLayout((prev) => ({ ...prev, ready: false }));
    // The packing aims at the box the picture is drawn in; a box not yet on
    // screen has no shape, and 2:1 is what the service page's canvas is.
    const box = wrapper.current;
    const aspectRatio = box && box.clientWidth > 0 && box.clientHeight > 0 ? box.clientWidth / box.clientHeight : 2;
    void layoutEr(spec, {
      grouped: arrangement === "groups",
      aspectRatio,
      nameOf: (aggregate) => index.aggregateById.get(aggregate)?.name ?? (aggregate.split(".").at(-1) ?? aggregate),
    }).then((result) => {
      if (!cancelled) setLayout({ positions: result.positions, groups: result.groups, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, [spec, arrangement]);

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

  // A search moves the camera, not only the lights. One hit is brought up
  // close; a handful are framed together; more than that is most of the
  // schema, so the view stays and the dimming does the work. Clearing the box
  // fits everything again, so the reader is not left zoomed into a corner.
  const hadTerm = useRef(false);
  useEffect(() => {
    if (!layout.ready) return;
    if (term.trim() === "") {
      if (hadTerm.current) flow.fitView({ padding: 0.1, duration: 250 });
      hadTerm.current = false;
      return;
    }
    hadTerm.current = true;
    const target = cursor >= 0 ? matchedIds.slice(cursor, cursor + 1) : matchedIds;
    if (target.length === 0 || target.length > SEARCH_FRAME_LIMIT) return;
    void flow.fitView({
      nodes: target.map((id) => ({ id })),
      padding: target.length === 1 ? 0.35 : 0.2,
      maxZoom: 1.25,
      duration: 250,
    });
  }, [flow, layout.ready, term, matchedIds, cursor]);

  const onJump = useCallback(() => {
    if (matchedIds.length === 0) return;
    setCursor((prev) => (prev + 1) % matchedIds.length);
  }, [matchedIds]);

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

  // The frames go first so that they are drawn under the cards; nothing
  // about them is interactive but the label, so a click on one reaches the
  // pane and clears the selection like empty canvas would.
  const frames: ErGroupNode[] = useMemo(
    () =>
      layout.groups.map((group) => ({
        id: `group:${group.id}`,
        type: "erGroup" as const,
        position: { x: group.x, y: group.y },
        width: group.width,
        height: group.height,
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        zIndex: -1,
        data: { name: group.name, aggregate: group.aggregate, count: group.count },
      })),
    [layout.groups],
  );

  const cards: ErFlowNode[] = useMemo(
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
  const nodes: (ErFlowNode | ErGroupNode)[] = useMemo(() => [...frames, ...cards], [frames, cards]);

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
          labelBgStyle: { fill: "var(--flow-card)" },
          labelBgPadding: [3, 1] as [number, number],
          labelShowBg: true,
          style: {
            stroke: colour,
            strokeWidth: lit ? EDGE_W_LIT : EDGE_W,
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

  const fitKey = layout.ready ? `fit-${nodes.length}-${mode}-${arrangement}` : "pending";
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
        cursor={cursor}
        onJump={onJump}
        arrangement={groupable ? arrangement : null}
        onArrangement={setChosen}
        views={views}
        showViews={showViews}
        onShowViews={setShowViews}
        showLineage={showLineage}
        onShowLineage={setShowLineage}
        wrapper={wrapper}
        name={store.id}
      />
      <div className="canvas-motion relative min-h-0 flex-1">
        {layout.ready ? null : <DiagramSkeleton />}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={erNodeTypes}
          onNodeClick={(_, node) => {
            if (node.type !== "erGroup") select(node.id, "diagram");
          }}
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
          <Background gap={20} size={2} />
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
  cursor,
  onJump,
  arrangement,
  onArrangement,
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
  /** The hit the reader stepped to with Enter, -1 for none yet. */
  cursor: number;
  onJump: () => void;
  /** How the cards are laid out; null when the schema is too small for the choice to matter. */
  arrangement: Arrangement | null;
  onArrangement: (value: Arrangement) => void;
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
  const say = useToastStore((s) => s.say);
  const [saving, setSaving] = useState(false);

  // The same way out as every other canvas: the file is named after the
  // store and the catalog revision, and the toast says what it was called.
  const exportImage = async (kind: ImageKind): Promise<void> => {
    const viewport = viewportOf(wrapper.current);
    if (!viewport) return;
    setSaving(true);
    try {
      const file = await saveCanvasImage(viewport, name, kind);
      say(`${kind.toUpperCase()} downloaded — ${file}`);
    } catch (cause) {
      say(
        `could not export ${kind.toUpperCase()}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
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
          onKeyDown={(e) => {
            // Enter walks the hits, best first; Escape lets go of the search
            // and the camera with it.
            if (e.key === "Enter") {
              e.preventDefault();
              onJump();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onTerm("");
            }
          }}
          placeholder="find a table or column"
          spellCheck={false}
          aria-label="Find a table or column"
          title="Enter steps through the hits, Escape clears"
          className="mono w-44 bg-transparent outline-none placeholder:text-muted"
        />
        {term ? (
          <span className="mono tnum shrink-0 text-muted" aria-live="polite">
            {cursor >= 0 ? `${cursor + 1}/${hits}` : hits}
          </span>
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

      {/* Only a schema big enough to come out as a column offers the choice;
          on a small one the flow is the picture and a frame would be noise. */}
      {arrangement ? (
        <div className="seg bg-canvas" role="group" aria-label="Arrangement">
          <button
            type="button"
            onClick={() => onArrangement("flow")}
            aria-pressed={arrangement === "flow"}
            className={arrangement === "flow" ? "is-on" : ""}
            title="One flow, roots on the left"
          >
            <Workflow size={11} aria-hidden className="inline" /> flow
          </button>
          <button
            type="button"
            onClick={() => onArrangement("groups")}
            aria-pressed={arrangement === "groups"}
            className={arrangement === "groups" ? "is-on" : ""}
            title="Tables by the model group they persist, groups packed to the canvas"
          >
            <LayoutGrid size={11} aria-hidden className="inline" /> groups
          </button>
        </div>
      ) : null}

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
        onClick={() => void exportImage("png")}
        disabled={saving}
        title="Save the schema as a PNG"
        aria-label="Export PNG"
        className="rounded-control border p-1.5 border-line bg-canvas text-muted hover:text-ink disabled:opacity-50"
      >
        <ImageDown size={12} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => void exportImage("svg")}
        disabled={saving}
        title="Save the schema as an SVG"
        aria-label="Export SVG"
        className="rounded-control border p-1.5 border-line bg-canvas text-muted hover:text-ink disabled:opacity-50"
      >
        <FileCode2 size={12} aria-hidden />
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
