// The dependency graph, drawn.
//
// Events are nodes here, not edge labels. The old canvas wrote an event's name
// once per consumer and hung it on a line, so the sample's nine events became
// twenty-one pieces of text lying across the densest part of the picture. A
// pill written once, with bare lines into and out of it, says the same thing
// with a third of the ink and gives the reader something to click.
//
// Everything geometric is elk's: the positions AND the routes. Nothing here
// invents a curve.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Background,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useStore,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { contextVar } from "../lib/context-color";
import type { EventGraph } from "../lib/event-graph";
import { bundles } from "../lib/event-graph";
import { servicePath } from "../routes";
import { useSelectionStore } from "../selection/store";
import { dependencyNodeTypes, TinyZoom } from "./DependencyNodes";
import type { DependencyNode } from "./DependencyNodes";
import { catalogIdOf, EVENT_NODE, layoutDependencyGraph } from "./dependency-layout";
import type { GraphMode, Layout } from "./dependency-layout";
import { dependencyEdgeTypes } from "./RoutedEdge";
import { FIT_OPTIONS, GraphToolbar } from "./GraphToolbar";
import { EDGE_W, EDGE_W_LIT, LEGIBLE_ZOOM } from "./theme";

/** How far out of the way everything more than one hop from the subject goes. */
const DIM_EDGE = 0.1;
const DIM_NODE = 0.2;

/** Past this many boxes the canvas is bigger than the frame; below it, it is not. */
const MINIMAP_FROM = 12;

export interface DependencyGraphProps {
  graph: EventGraph;
  mode: GraphMode;
  onMode: (mode: GraphMode) => void;
  /**
   * Changes whenever the filters do. Remounting the flow on a new value is
   * what makes fitView measure the layout that just arrived rather than the
   * one it replaced.
   */
  fitKey: string;
}

export function DependencyGraph({
  graph,
  mode,
  onMode,
  fitKey,
}: DependencyGraphProps) {
  const navigate = useNavigate();
  const [layout, setLayout] = useState<Layout | null>(null);
  const [focusing, setFocusing] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  const selectionId = useSelectionStore((s) => s.selection?.id ?? null);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);

  // Below the legible zoom an 11px label is a smudge, so pills give up their
  // name and keep their icon. A boolean, not the zoom: a pinch that stays on
  // one side of the threshold re-renders nothing.
  const tiny = useStore((s) => s.transform[2] < LEGIBLE_ZOOM);

  useEffect(() => {
    let cancelled = false;
    setLayout(null);
    void layoutDependencyGraph(graph, mode).then((next) => {
      if (!cancelled) setLayout(next);
    });
    return () => {
      cancelled = true;
    };
  }, [graph, mode]);

  // --- focus -------------------------------------------------------------

  // Esc unwinds the innermost thing first. It is caught on the way DOWN so it
  // gets ahead of the shell's "Esc clears the selection": a reader who has
  // dimmed the canvas means the dimming when they press it.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setFocused(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [focused]);

  /**
   * One hop, in the sense a reader means it.
   *
   * In events mode the graph is literally bipartite, so one hop from a service
   * reaches only pills - focusing would dim every other service to nothing and
   * answer no question at all. The hop that is being counted is the dependency:
   * this service, the events on either side of it, and whoever is at the far
   * end of those events.
   */
  const neighbourhood = useMemo(() => {
    if (!focused) return null;
    const nodes = new Set<string>([focused]);
    const edges = new Set<string>();
    if (mode === "compact") {
      for (const bundle of bundles(graph)) {
        if (bundle.from !== focused && bundle.to !== focused) continue;
        nodes.add(bundle.from);
        nodes.add(bundle.to);
        edges.add(bundle.id);
      }
      return { nodes, edges };
    }
    for (const event of graph.events) {
      const touches =
        event.publisher === focused ||
        event.consumers.some((c) => c.service === focused);
      if (!touches) continue;
      nodes.add(EVENT_NODE(event.id));
      nodes.add(event.publisher);
      edges.add(`pub:${event.id}`);
      for (const consumer of event.consumers) {
        if (consumer.self) continue;
        nodes.add(consumer.service);
        edges.add(`con:${event.id}->${consumer.service}`);
      }
    }
    return { nodes, edges };
  }, [focused, graph, mode]);

  // --- what actually gets handed to React Flow ---------------------------

  const nodes: DependencyNode[] = useMemo(() => {
    const built = layout?.nodes ?? [];
    return built.map((node) => ({
      ...node,
      selected:
        node.id === selectionId ||
        (node.type === "event" && node.id === EVENT_NODE(selectionId ?? "")),
      style: {
        ...node.style,
        opacity:
          neighbourhood && !neighbourhood.nodes.has(node.id) ? DIM_NODE : 1,
      },
    }));
  }, [layout, selectionId, neighbourhood]);

  const edges: Edge[] = useMemo(() => {
    const built = layout?.edges ?? [];
    return built.map((edge) => {
      const dimmed = neighbourhood ? !neighbourhood.edges.has(edge.id) : false;
      // A selected event lights the lines that carry it. Selection thickens;
      // focus dims. They are different questions and they read differently.
      const lit =
        selectionId !== null &&
        (edge.data?.["eventId"] === selectionId ||
          edge.data?.["bundleId"] === selectionId);
      return {
        ...edge,
        selected: edge.id === selectionId,
        style: {
          ...edge.style,
          opacity: dimmed ? DIM_EDGE : 1,
          strokeWidth: lit ? EDGE_W_LIT : (edge.style?.strokeWidth ?? EDGE_W),
        },
        zIndex: lit ? 10 : 0,
      };
    });
  }, [layout, neighbourhood, selectionId]);

  // --- interaction -------------------------------------------------------

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (focusing && node.type === "service") setFocused(node.id);
      select(catalogIdOf(node.id), "diagram");
    },
    [focusing, select],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type !== "service") return;
      const to = servicePath(node.id);
      if (to) navigate(to);
    },
    [navigate],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const bundleId = edge.data?.["bundleId"];
      if (typeof bundleId === "string") {
        select(bundleId, "diagram");
        return;
      }
      const eventId = edge.data?.["eventId"];
      if (typeof eventId === "string") select(eventId, "diagram");
    },
    [select],
  );

  const ready = layout !== null;
  const minimap = nodes.length > MINIMAP_FROM;

  return (
    /* The box is the box whether elk has answered or not: the skeleton is
       laid over it, never in place of it, so nothing reflows on arrival. */
    <div className="relative h-full w-full">
      {ready ? null : <DiagramSkeleton />}
      <TinyZoom.Provider value={tiny}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={dependencyNodeTypes}
          edgeTypes={dependencyEdgeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => {
            setFocused(null);
            clear("diagram");
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={FIT_OPTIONS}
          minZoom={0.08}
          maxZoom={2}
          key={ready ? `fit-${fitKey}-${nodes.length}-${edges.length}` : "pending"}
        >
          <Background gap={20} size={2} />
          <GraphToolbar
            mode={mode}
            onMode={onMode}
            focusing={focusing}
            onFocusing={(on) => {
              setFocusing(on);
              if (!on) setFocused(null);
            }}
            focused={focused}
          />
          {minimap ? (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              ariaLabel="Graph overview"
              nodeBorderRadius={4}
              nodeColor={(node) =>
                contextVar(
                  (node.data as { context?: string | null }).context ?? null,
                )
              }
              nodeStrokeWidth={0}
            />
          ) : null}
        </ReactFlow>
      </TinyZoom.Provider>
    </div>
  );
}

export function DependencyGraphPane(props: DependencyGraphProps) {
  return (
    <ReactFlowProvider>
      <DependencyGraph {...props} />
    </ReactFlowProvider>
  );
}
