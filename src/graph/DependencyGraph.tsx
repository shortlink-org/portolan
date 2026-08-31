import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ServiceGraph } from "../lib/derive";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { servicePath } from "../routes";
import { useSelectionStore } from "../selection/store";
import { nodeTypes } from "./nodes";
import { useElkFlow } from "./useElkFlow";
import type { FlowSpec } from "./useElkFlow";

const DIM = 0.12;

export function DependencyGraph({ graph }: { graph: ServiceGraph }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);

  // Hover is local and never reaches the store; selection is the opposite.
  const selectionId = useSelectionStore((s) => s.selection?.id ?? null);
  const selectionKind = useSelectionStore((s) => s.selection?.kind ?? null);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);

  const spec: FlowSpec = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        data: {
          label: n.label,
          context: n.context,
          ghost: n.ghost,
          kind: "service" as const,
        },
      })),
      edges: graph.edges.map((e, i) => ({
        id: `${e.from}->${e.to}#${e.eventId}#${i}`,
        source: e.from,
        target: e.to,
        label: e.label,
        status: e.status,
        eventId: e.eventId,
      })),
      direction: "RIGHT",
    }),
    [graph],
  );

  const { nodes, edges, ready } = useElkFlow(spec);
  // Remounting once elk has produced positions is what actually makes fitView
  // measure the real layout; fitting before that races the measurement.
  const fitKey = ready ? `fit-${nodes.length}-${edges.length}` : "pending";

  // Twenty-one labelled edges over five services is dense on purpose: the
  // catalog really is that connected. Hovering isolates one service's traffic
  // instead of hiding the density behind an aggregate edge.
  const shownEdges: Edge[] = useMemo(
    () =>
      edges.map((edge) => {
        // A selected event is carried by exactly the edges that deliver it.
        if (selectionKind === "event") {
          const lit = edge.data?.["eventId"] === selectionId;
          return {
            ...edge,
            style: {
              ...edge.style,
              opacity: lit ? 1 : DIM,
              strokeWidth: lit ? 2 : 1.2,
            },
            labelStyle: { ...edge.labelStyle, opacity: lit ? 1 : 0 },
            labelBgStyle: { ...edge.labelBgStyle, opacity: lit ? 1 : 0 },
            zIndex: lit ? 10 : 0,
          };
        }
        if (!hovered) return edge;
        const lit = edge.source === hovered || edge.target === hovered;
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: lit ? 1 : DIM,
            strokeWidth: lit ? 2 : 1.2,
          },
          labelStyle: { ...edge.labelStyle, opacity: lit ? 1 : 0 },
          labelBgStyle: { ...edge.labelBgStyle, opacity: lit ? 1 : 0 },
          zIndex: lit ? 10 : 0,
        };
      }),
    [edges, hovered, selectionKind, selectionId],
  );

  const shownNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectionId,
        style: {
          ...node.style,
          opacity: hovered && hovered !== node.id ? 0.45 : 1,
        },
      })),
    [nodes, hovered, selectionId],
  );

  // A click selects; the page it belongs to is a double-click away. Selecting
  // in place is what lets the detail rail answer "what is this?" without
  // losing the picture that raised the question.
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => select(node.id, "diagram"),
    [select],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const to = servicePath(node.id);
      if (to) navigate(to);
    },
    [navigate],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const eventId = edge.data?.["eventId"];
      if (typeof eventId === "string") select(eventId, "diagram");
    },
    [select],
  );

  return (
    /* The box is the box whether elk has answered or not: the skeleton is
       laid over it, never in place of it, so nothing reflows on arrival. */
    <div className="relative h-full w-full">
      {ready ? null : <DiagramSkeleton />}
      <ReactFlow
        nodes={shownNodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => clear("diagram")}
        onNodeMouseEnter={(_, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.15}
        maxZoom={2}
        key={fitKey}
      >
        <Background gap={22} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
}

export function DependencyGraphPane({ graph }: { graph: ServiceGraph }) {
  return (
    <ReactFlowProvider>
      <DependencyGraph graph={graph} />
    </ReactFlowProvider>
  );
}
