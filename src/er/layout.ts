// Where the cards go.
//
// One decision worth spelling out: the FK edges handed to elk run the OPPOSITE
// way from the edges drawn. A foreign key points from the child to the parent,
// so a layered pass over the real direction puts the aggregate root on the
// right, at the end of every arrow. Readers do not read a schema that way —
// they start at the root and follow what hangs off it — so the layout is fed
// parent → child and the canvas draws child → parent over the top of it.
//
// Lineage is fed exactly as it is drawn. It already points the way a reader
// reads: source on the left, the view computed from it on the right. Reversing
// it too would put every view before the tables it reads, which is the one
// arrangement that makes a lineage picture unreadable.

import { layoutWithElk } from "../graph/elk";
import type { ErSpec } from "./spec";

export interface ErLayout {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

export interface ErLayoutInput {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string }[];
}

/**
 * The layout graph: real nodes, reversed edges, and no duplicate pair. Two
 * foreign keys between the same two tables are one constraint as far as
 * placement is concerned, and feeding both makes elk pull them closer than a
 * single relationship warrants.
 */
export function layoutInput(spec: ErSpec): ErLayoutInput {
  const seen = new Set<string>();
  const edges: ErLayoutInput["edges"] = [];
  for (const edge of spec.edges) {
    // A self-reference constrains nothing and elk lays it out as a cycle of
    // one; the canvas still draws it.
    if (edge.from === edge.to) continue;
    const source = edge.kind === "fk" ? edge.to : edge.from;
    const target = edge.kind === "fk" ? edge.from : edge.to;
    const pair = `${source}->${target}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    edges.push({ id: pair, source, target });
  }

  return {
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
    })),
    edges,
  };
}

/** Lays a spec out left to right, roots first. Falls back to a column on failure. */
export async function layoutEr(spec: ErSpec): Promise<ErLayout> {
  const input = layoutInput(spec);
  if (input.nodes.length === 0) {
    return { positions: {}, width: 0, height: 0 };
  }

  const { positions, width, height } = await layoutWithElk({
    ...input,
    direction: "RIGHT",
    // Wider than the graph views' default. A table card is 208px and an edge
    // between two of them carries "on delete cascade" often enough that a
    // narrow gap leaves the label sitting on top of the line it describes.
    layerSpacing: 170,
    nodeSpacing: 28,
  });
  return { positions, width, height };
}
