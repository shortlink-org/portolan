import { useCallback, useMemo } from "react";
import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Event } from "../catalog";
import { index } from "../data";
import { nodeTypes } from "./nodes";
import { useElkFlow } from "./useElkFlow";
import type { FlowSpec } from "./useElkFlow";
import { EVENT_W } from "./theme";
import { useSelectionStore } from "../selection/store";

/** producer -> event -> consumers, computed at runtime from the catalog. */
export function FocusedEventGraph({
  event,
  height = 220,
}: {
  event: Event;
  height?: number;
}) {
  const selectionId = useSelectionStore((s) => s.selection?.id ?? null);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);

  const owner = index.eventOwner.get(event.id);
  const producerId = owner?.service.id ?? "unknown-producer";
  const producerContext = owner
    ? (index.serviceContext.get(owner.service.id)?.id ?? null)
    : null;

  const spec: FlowSpec = useMemo(() => {
    const eventNodeId = `event:${event.id}`;
    return {
      nodes: [
        {
          id: producerId,
          data: {
            label: producerId,
            context: producerContext,
            ghost: !owner,
            kind: "producer" as const,
          },
        },
        {
          id: eventNodeId,
          width: EVENT_W,
          data: {
            label: event.name,
            context: null,
            ghost: false,
            kind: "event" as const,
          },
        },
        ...event.consumers.map((consumer) => ({
          id: consumer.service,
          data: {
            label: consumer.service,
            context: index.serviceContext.get(consumer.service)?.id ?? null,
            ghost: !index.serviceById.has(consumer.service),
            kind: "service" as const,
          },
        })),
      ],
      edges: [
        {
          id: `publishes:${event.id}`,
          source: producerId,
          target: eventNodeId,
          label: "publishes",
          status: "verified" as const,
        },
        ...event.consumers.map((consumer) => ({
          id: `consumes:${consumer.service}`,
          source: eventNodeId,
          target: consumer.service,
          label: consumer.status,
          status: consumer.status,
          eventId: event.id,
        })),
      ],
      direction: "RIGHT" as const,
      layerSpacing: 96,
    };
  }, [event, owner, producerContext, producerId]);

  const { nodes, edges, ready } = useElkFlow(spec);

  // The middle node stands for the event itself; the others are services. Both
  // are catalog ids, so a click here reads the same as a click anywhere else.
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) =>
      select(node.id.startsWith("event:") ? node.id.slice(6) : node.id, "diagram"),
    [select],
  );

  const shownNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected:
          node.id === selectionId || node.id === `event:${selectionId ?? ""}`,
      })),
    [nodes, selectionId],
  );

  return (
    <div style={{ height }} className="w-full border">
      <ReactFlow
        nodes={shownNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => clear("diagram")}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        maxZoom={1.5}
        key={ready ? `fit-${event.id}-${nodes.length}` : "pending"}
      >
        <Background gap={18} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
}

export function FocusedEventGraphPane(props: {
  event: Event;
  height?: number;
}) {
  return (
    <ReactFlowProvider>
      <FocusedEventGraph {...props} />
    </ReactFlowProvider>
  );
}
