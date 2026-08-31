// elkjs layout for everything React Flow renders. Async by nature, so callers
// hold the result in state; nothing here touches React.

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";

const elk = new ELK();

export interface LayoutInput {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string; labelWidth?: number }[];
  direction?: "RIGHT" | "DOWN";
  /** extra space between layers; the focused graph wants more than the big one */
  layerSpacing?: number;
  nodeSpacing?: number;
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

export async function layoutWithElk(input: LayoutInput): Promise<LayoutResult> {
  const children: ElkNode[] = input.nodes.map((n) => ({
    id: n.id,
    width: n.width,
    height: n.height,
  }));
  const edges: ElkExtendedEdge[] = input.edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
    ...(e.labelWidth
      ? { labels: [{ text: "", width: e.labelWidth, height: 14 }] }
      : {}),
  }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": input.direction ?? "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        input.layerSpacing ?? 130,
      ),
      "elk.spacing.nodeNode": String(input.nodeSpacing ?? 34),
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeLabel": "6",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.padding": "[top=16,left=16,bottom=16,right=16]",
    },
    children,
    edges,
  };

  const laid = await elk.layout(graph);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const child of laid.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return {
    positions,
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}
