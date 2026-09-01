import { useCallback, useMemo } from "react";
import {
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Event } from "../catalog";
import { index } from "../data";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { nodeTypes } from "./nodes";
import { useElkFlow } from "./useElkFlow";
import type { FlowSpec } from "./useElkFlow";
import { ViewportSeg } from "./GraphToolbar";
import { EVENT_W, NODE_H } from "./theme";
import { useSelectionStore } from "../selection/store";

/** Air above and below the picture. Anything more is a canvas with a hole in it. */
const PAD = 28;
/** elk's own gap between two nodes in the same layer. */
const ROW_GAP = 34;

/** producer -> event -> consumers, computed at runtime from the catalog. */
export function FocusedEventGraph({
  event,
  height,
}: {
  event: Event;
  /** Overrides the height the picture asks for. Nothing does, so far. */
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
            role: "publisher",
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
            role: "event",
          },
        },
        ...event.consumers.map((consumer) => ({
          id: consumer.service,
          data: {
            label: consumer.service,
            context: index.serviceContext.get(consumer.service)?.id ?? null,
            ghost: !index.serviceById.has(consumer.service),
            kind: "service" as const,
            role: "consumer",
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
          // A verified consumer is the ordinary case, and labelling every
          // ordinary line "verified" leaves nothing for the two lines that
          // are not. Those keep their word; the rest say what they do.
          label: consumer.status === "verified" ? "consumes" : consumer.status,
          status: consumer.status,
          eventId: event.id,
        })),
      ],
      direction: "RIGHT" as const,
      layerSpacing: 96,
    };
  }, [event, owner, producerContext, producerId]);

  const { nodes, edges, ready } = useElkFlow(spec);

  /**
   * The canvas is as tall as the picture in it.
   *
   * It was 230px whatever it held, so three nodes in a row sat in the middle
   * of a field four times their height - and fitView could not take up the
   * slack, because it stops at 1:1 rather than blowing the boxes up. Once elk
   * has run the answer is exact; before that it is elk's own row pitch, which
   * is what the answer will turn out to be.
   */
  const measured = useMemo(() => {
    if (nodes.length === 0) return null;
    const top = Math.min(...nodes.map((n) => n.position.y));
    const bottom = Math.max(
      ...nodes.map((n) => n.position.y + (n.height ?? NODE_H)),
    );
    return Math.round(bottom - top);
  }, [nodes]);
  const rows = Math.max(1, event.consumers.length);
  const content = measured ?? rows * NODE_H + (rows - 1) * ROW_GAP;
  const canvasHeight = height ?? Math.min(420, content + PAD * 2);

  // The middle node stands for the event itself; the others are services. Both
  // are catalog ids, so a click here reads the same as a click anywhere else.
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) =>
      select(
        node.id.startsWith("event:") ? node.id.slice(6) : node.id,
        "diagram",
      ),
    [select],
  );

  /**
   * Whether the whole picture is on screen at 1:1.
   *
   * fitView stops at maxZoom 1, so a graph that fits lands on exactly 1 and
   * one that does not lands below it. That one number decides whether this is
   * a canvas or a picture: a picture needs no zoom controls - they would have
   * nothing to reveal, and on a canvas 104px tall they overlap the only row
   * in it - and it should not swallow the page's scroll on the way past.
   */
  const zoom = useStore((s) => s.transform[2]);
  const fits = zoom >= 0.999;

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
    <div
      style={{ height: canvasHeight }}
      className="relative w-full overflow-hidden rounded-card border border-line bg-canvas shadow-xs"
    >
      {ready ? null : <DiagramSkeleton />}
      <ReactFlow
        nodes={shownNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => clear("diagram")}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={!fits}
        zoomOnScroll={!fits}
        zoomOnPinch={!fits}
        zoomOnDoubleClick={!fits}
        preventScrolling={!fits}
        proOptions={{ hideAttribution: true }}
        fitView
        // 1 rather than 1.5: the boxes are drawn at the size they are meant to
        // be read at, and a graph of three nodes has no reason to be enlarged
        // past it.
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        key={ready ? `fit-${event.id}-${nodes.length}` : "pending"}
      >
        <Background gap={18} size={1} color="var(--border)" />
        {fits ? null : (
          <Panel position="top-right">
            <ViewportSeg />
          </Panel>
        )}
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
