import { useEffect, useState } from "react";
import type { Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { Status } from "../catalog";
import { layoutWithElk } from "./elk";
import type { PortolanNode, ServiceNodeData } from "./nodes";
import { NODE_H, NODE_W, statusColor, statusDash } from "./theme";

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
      const { positions } = await layoutWithElk({
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

      const edges: Edge[] = spec.edges.map((e) => {
        const color = statusColor(e.status);
        const dash = statusDash(e.status);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          type: "bezier",
          animated: false,
          style: {
            stroke: color,
            strokeWidth: 1.2,
            ...(dash ? { strokeDasharray: dash } : {}),
          },
          labelStyle: {
            fill: "var(--fg-muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          },
          labelBgStyle: { fill: "var(--bg)" },
          labelBgPadding: [3, 1] as [number, number],
          labelShowBg: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 14,
            height: 14,
          },
          data: e.eventId ? { eventId: e.eventId } : {},
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
