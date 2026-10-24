import { useEffect, useState } from "react";
import type { Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { Status } from "../catalog";
import { layoutWithElk } from "./elk";
import type { PortolanNode, ServiceNodeData } from "./nodes";
import type { RoutedEdgeType } from "./RoutedEdge";
import { EDGE_W, NODE_H, NODE_W, statusColor, statusDash } from "./theme";

export interface FlowSpec {
  nodes: {
    id: string;
    data: ServiceNodeData;
    width?: number;
    height?: number;
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
    label: string;
    status: Status;
    eventId?: string;
  }[];
  direction?: "RIGHT" | "DOWN";
  layerSpacing?: number;
  /** Keep nodes of one layer in the order the spec lists them. */
  considerModelOrder?: boolean;
  /**
   * Pin every source to the right and every target to the left. Layered,
   * acyclic diagrams want that discipline; participant maps with responses
   * running back to an earlier node need elk to choose the clear side.
   */
  fixedPorts?: boolean;
}

export interface FlowState {
  nodes: PortolanNode[];
  edges: Edge[];
  ready: boolean;
}

/** Runs elk whenever the spec changes and returns React Flow's nodes and edges. */
export function useElkFlow(spec: FlowSpec): FlowState {
  const [state, setState] = useState<FlowState>({
    nodes: [],
    edges: [],
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const { positions, routes } = await layoutWithElk({
        nodes: spec.nodes.map((n) => ({
          id: n.id,
          width: n.width ?? NODE_W,
          height: n.height ?? NODE_H,
        })),
        edges: spec.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          labelWidth: Math.max(40, e.label.length * 6),
        })),
        ...(spec.direction ? { direction: spec.direction } : {}),
        ...(spec.layerSpacing ? { layerSpacing: spec.layerSpacing } : {}),
        ...(spec.considerModelOrder ? { considerModelOrder: true } : {}),
        ports: spec.fixedPorts ?? true,
        edgeRouting: "ORTHOGONAL",
      });
      if (cancelled) return;

      const nodes: PortolanNode[] = spec.nodes.map((n) => ({
        id: n.id,
        type: "portolan",
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: n.data,
        initialWidth: n.width ?? NODE_W,
        initialHeight: n.height ?? NODE_H,
        width: n.width ?? NODE_W,
        height: n.height ?? NODE_H,
        draggable: false,
        connectable: false,
      }));

      const edges: RoutedEdgeType[] = spec.edges.map((e) => {
        const color = statusColor(e.status);
        const dash = statusDash(e.status);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          type: "routed",
          animated: false,
          style: {
            stroke: color,
            strokeWidth: EDGE_W,
            ...(dash ? { strokeDasharray: dash } : {}),
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 14,
            height: 14,
          },
          data: {
            points: routes[e.id] ?? [],
            ...(e.eventId ? { eventId: e.eventId } : {}),
          },
        };
      });

      setState({ nodes, edges, ready: true });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [spec]);

  return state;
}
