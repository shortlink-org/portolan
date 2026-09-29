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
import { EVENT_W, NODE_H, NODE_W } from "./theme";
import { useSelectionStore } from "../selection/store";
import { useNavigate } from "react-router";
import { triggersOf } from "../lib/triggers";
import { commandAnchor } from "../flow/command-info";
import { AGGREGATE_ANCHOR, paths } from "../routes";

/**
 * A node wide enough for its 12px mono label: a state change is two state
 * names and an arrow, and cut to "confirmed → canc…" it no longer says where
 * the root goes. Capped, so one long name cannot push the event off the page.
 */
function fitLabel(label: string): number {
  return Math.min(280, Math.max(NODE_W, Math.ceil(label.length * 7.3) + 62));
}

/** Air above and below the picture. Anything more is a canvas with a hole in it. */
const PAD = 28;
/** elk's own gap between two nodes in the same layer. */
const ROW_GAP = 34;

/**
 * What publishes the event -> the event -> who consumes it, computed at runtime
 * from the catalog. The left column is the operations and lifecycle moves that
 * say they emit it, or the publishing service when none do.
 */
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

  // What the service does to publish it, when its aggregates say: the
  // operations that emit it and the lifecycle moves that announce it. They
  // take the publisher's place on the left - each one is the publisher, named
  // by the thing it runs - and carry its context colour on their tiles.
  const triggers = useMemo(
    () => (owner ? triggersOf(owner.service, event.id) : []),
    [owner, event.id],
  );

  const spec: FlowSpec = useMemo(() => {
    const eventNodeId = `event:${event.id}`;
    const context = producerContext ?? "";
    const aggregateAt = (slug: string) =>
      owner ? paths.aggregate(context, owner.service.slug, slug) : "";
    const left = triggers.length
      ? triggers.map((trigger) =>
          trigger.kind === "operation"
            ? {
                id: `op:${trigger.aggregate.id}/${trigger.operation.id}`,
                width: fitLabel(trigger.operation.id),
                data: {
                  label: trigger.operation.id,
                  context: producerContext,
                  ghost: false,
                  kind: "command" as const,
                  role: trigger.operation.kind,
                  href: `${aggregateAt(trigger.aggregate.slug)}#${
                    trigger.operation.kind === "command"
                      ? encodeURIComponent(commandAnchor(trigger.operation.id))
                      : AGGREGATE_ANCHOR.queries
                  }`,
                },
              }
            : {
                id: `move:${trigger.aggregate.id}/${trigger.transition.on}/${trigger.transition.from}/${trigger.transition.to}`,
                width: fitLabel(`${trigger.transition.from} → ${trigger.transition.to}`),
                data: {
                  label: `${trigger.transition.from} → ${trigger.transition.to}`,
                  context: producerContext,
                  ghost: false,
                  kind: "move" as const,
                  role: `${trigger.transition.on} · state change`,
                  href: `${aggregateAt(trigger.aggregate.slug)}#${AGGREGATE_ANCHOR.lifecycle}`,
                },
              },
        )
      : [
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
        ];
    return {
      nodes: [
        ...left,
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
        // Every arrow into the event is read from the publisher's own code, so
        // they share one status; the word on the line says which fact it is.
        ...left.map((node) => ({
          id: `publishes:${node.id}`,
          source: node.id,
          target: eventNodeId,
          label:
            node.data.kind === "command"
              ? "emits"
              : node.data.kind === "move"
                ? "announces"
                : "publishes",
          status: "verified" as const,
        })),
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
      // Commands before state changes, as the section above lists them.
      considerModelOrder: true,
    };
  }, [event, owner, producerContext, producerId, triggers]);

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
  const rows = Math.max(1, event.consumers.length, triggers.length);
  const content = measured ?? rows * NODE_H + (rows - 1) * ROW_GAP;
  const canvasHeight = height ?? Math.min(420, content + PAD * 2);

  // The middle node stands for the event itself; the others are services. Both
  // are catalog ids, so a click here reads the same as a click anywhere else.
  // A command or a state change is a line on its aggregate's page rather than
  // an entity of its own, so a click on one goes there instead of selecting.
  const navigate = useNavigate();
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string; data?: { href?: string } }) => {
      if (node.data?.href) {
        void navigate(node.data.href);
        return;
      }
      select(
        node.id.startsWith("event:") ? node.id.slice(6) : node.id,
        "diagram",
      );
    },
    [select, navigate],
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
      data-fullscreen
      style={{ height: canvasHeight }}
      className="canvas-motion relative w-full overflow-hidden rounded-card border border-line shadow-xs"
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
        <Background gap={20} size={2} />
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
