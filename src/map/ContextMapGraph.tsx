// The map, drawn.
//
// ONE LINE PER RELATIONSHIP, which is what a context map is and what every
// other graph in this app is not. The dependency graph draws an arrow per
// event because an event is the thing it is about; here the thing is the
// relationship, and a pair that leans on each other both ways is not two
// facts - it is one fact called a partnership. Two arcs between the same two
// boxes would also force a layered layout to route one of them backwards
// around the whole diagram, which is how a map of three domains ends up
// looking like a circuit.
//
// So: the arrowheads say which way the leaning runs - one head for a customer
// and its supplier, two for a partnership, none for a pair that shares a type
// and nothing else - and the label says which pattern that makes, in the same
// word the list below uses. The dash is the app's usual three markers, worst
// status among everything the line carries: a relationship is known no better
// than its least-known hop.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Background,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Catalog, Status } from "../catalog";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { layoutWithElk } from "../graph/elk";
import { statusColor, statusDash } from "../graph/theme";
import type { PortolanNode } from "../graph/nodes";
import { PATTERN_LABEL } from "../lib/context-map";
import type { ContextRelation } from "../lib/context-map";
import { paths } from "../routes";
import { useSelectionStore } from "../selection/store";
import { CTX_NODE_H, CTX_NODE_W, contextNodeTypes } from "./ContextNode";
import { mapEdgeTypes } from "./FloatingEdge";

const DIM = 0.14;

/** A chain is known no better than its least-known hop. */
function worstStatus(statuses: readonly Status[]): Status {
  if (statuses.includes("unresolved")) return "unresolved";
  if (statuses.includes("declared")) return "declared";
  return "verified";
}

/** The counted pattern the line stands for; the read ones are for the list. */
function lineLabel(relation: ContextRelation): string {
  const counted = relation.patterns.find((p) => p.basis === "counted");
  return counted ? PATTERN_LABEL[counted.name] : "";
}

interface Drawn {
  nodes: PortolanNode[];
  edges: Edge[];
  ready: boolean;
}

export function ContextMapGraph({
  catalog,
  relations,
}: {
  catalog: Catalog;
  relations: readonly ContextRelation[];
}) {
  const navigate = useNavigate();
  const selectionId = useSelectionStore((s) => s.selection?.id ?? null);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);
  const [drawn, setDrawn] = useState<Drawn>({
    nodes: [],
    edges: [],
    ready: false,
  });

  // One entry per pair the catalog has anything to say about. `back` is what
  // turns an arrow into a double-headed one; elk only ever sees a -> b, so the
  // layout never has a cycle to route around.
  const lines = useMemo(
    () =>
      relations
        .filter((r) => r.dependencies.length > 0 || r.shared.length > 0)
        .map((relation) => {
          const forward = relation.dependencies.find(
            (d) => d.upstream === relation.a,
          );
          const back = relation.dependencies.find(
            (d) => d.upstream === relation.b,
          );
          const links = relation.dependencies.flatMap((d) => d.links);
          return {
            relation,
            // Source is the upstream end wherever there is only one, so a
            // single arrowhead always points from supplier to customer.
            source: forward || !back ? relation.a : relation.b,
            target: forward || !back ? relation.b : relation.a,
            heads: relation.dependencies.length,
            status: worstStatus(links.map((l) => l.status)),
            label: lineLabel(relation),
          };
        }),
    [relations],
  );

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const { positions } = await layoutWithElk({
        nodes: catalog.contexts.map((c) => ({
          id: c.id,
          width: CTX_NODE_W,
          height: CTX_NODE_H,
        })),
        edges: lines.map((line) => ({
          id: line.relation.id,
          source: line.source,
          target: line.target,
          labelWidth: Math.max(60, line.label.length * 6),
        })),
        algorithm: "stress",
        // Far enough apart that a pattern name fits in the gap: "customer /
        // supplier" is 110px of mono, and a label wider than the space between
        // two boxes is a label lying across one of them.
        edgeLength: 300,
        nodeSpacing: 130,
      });
      if (cancelled) return;

      const nodes: PortolanNode[] = catalog.contexts.map((context) => ({
        id: context.id,
        type: "portolan",
        position: positions[context.id] ?? { x: 0, y: 0 },
        data: {
          label: context.id,
          sub: context.name,
          context: context.id,
          ghost: false,
          kind: "context",
          ...(context.classification ? { tag: context.classification } : {}),
        },
        initialWidth: CTX_NODE_W,
        initialHeight: CTX_NODE_H,
        width: CTX_NODE_W,
        height: CTX_NODE_H,
        draggable: false,
        connectable: false,
      }));

      const edges: Edge[] = lines.map((line) => {
        const color = statusColor(line.status);
        const dash = statusDash(line.status);
        const head = {
          type: MarkerType.ArrowClosed,
          color,
          width: 14,
          height: 14,
        };
        return {
          id: line.relation.id,
          source: line.source,
          target: line.target,
          label: line.label,
          type: "floating",
          style: {
            stroke: color,
            strokeWidth: 1.4,
            ...(dash ? { strokeDasharray: dash } : {}),
            // A pair joined by a shared type and nothing else gets a line
            // with no heads at all; it is a fact about both, not a direction.
            ...(line.heads === 0 ? { strokeDasharray: "1 4" } : {}),
          },
          ...(line.heads > 0 ? { markerEnd: head } : {}),
          ...(line.heads === 2 ? { markerStart: head } : {}),
        };
      });

      setDrawn({ nodes, edges, ready: true });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [catalog, lines]);

  const fitKey = drawn.ready
    ? `fit-${drawn.nodes.length}-${drawn.edges.length}`
    : "pending";

  // A selected domain lights the lines it is on and dims the rest, so "who
  // does shop answer to" is one click rather than a reading of the whole map.
  const shownEdges = useMemo(() => {
    if (!selectionId) return drawn.edges;
    return drawn.edges.map((edge) => {
      const lit = edge.source === selectionId || edge.target === selectionId;
      // The label reads its opacity off the same style object, so a dimmed
      // line and its dimmed label can never disagree.
      return {
        ...edge,
        style: { ...edge.style, opacity: lit ? 1 : DIM },
        zIndex: lit ? 10 : 0,
      };
    });
  }, [drawn.edges, selectionId]);

  const shownNodes = useMemo(
    () =>
      drawn.nodes.map((node) => ({
        ...node,
        selected: node.id === selectionId,
        style: {
          ...node.style,
          opacity: selectionId && selectionId !== node.id ? 0.55 : 1,
        },
      })),
    [drawn.nodes, selectionId],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => select(node.id, "diagram"),
    [select],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => navigate(paths.context(node.id)),
    [navigate],
  );

  return (
    <div className="relative h-full w-full">
      {drawn.ready ? null : <DiagramSkeleton />}
      <ReactFlow
        nodes={shownNodes}
        edges={shownEdges}
        nodeTypes={contextNodeTypes}
        edgeTypes={mapEdgeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={() => clear("diagram")}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.2}
        maxZoom={1.6}
        key={fitKey}
      >
        <Background gap={22} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
}

export function ContextMapPane(props: {
  catalog: Catalog;
  relations: readonly ContextRelation[];
}) {
  return (
    <ReactFlowProvider>
      <ContextMapGraph {...props} />
    </ReactFlowProvider>
  );
}
