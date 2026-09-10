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
//
// A big schema is laid out in two steps rather than one. A single layered
// pass over a hundred-odd tables comes out as a column: the graph is shallow
// and wide, one layer holds fifty cards, and no direction fixes that -
// measured on a 138-table schema, left-to-right, top-down and every wrapping
// option elk has all fit the canvas at a tenth of scale. What the tables do
// have is the model group each one persists, so the cards of one group are
// laid out among themselves and the groups are packed as rectangles to the
// canvas's own proportions, which fits the same schema at nearly three times
// the scale and reads by module rather than as one sheet.

import { layoutGroupsWithElk, layoutWithElk } from "../graph/elk";
import type { ErNode, ErSpec } from "./spec";

export interface ErGroupFrame {
  id: string;
  name: string;
  /** The aggregate the group is, or null for the tables that persist none. */
  aggregate: string | null;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ErLayout {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
  /** Empty when the layout is one flow. */
  groups: ErGroupFrame[];
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

/** Fewer tables than this is a schema one layered pass draws fine. */
export const GROUP_MIN_TABLES = 40;
/** Fewer model groups than this and grouping would draw one big frame. */
export const GROUP_MIN_GROUPS = 3;

/** What every table that persists no model is grouped under. */
export const UNGROUPED = "other";

export interface ErGrouping {
  id: string;
  name: string;
  aggregate: string | null;
  nodes: string[];
}

/**
 * The cards by the model group they persist, biggest group first and the
 * ungrouped rest last - which is the order the packing takes them in, and
 * big-first is what packs tightest.
 */
export function groupsOf(
  nodes: readonly Pick<ErNode, "id" | "aggregate">[],
  nameOf: (aggregate: string) => string,
): ErGrouping[] {
  const byAggregate = new Map<string | null, string[]>();
  for (const node of nodes) {
    const key = node.aggregate;
    byAggregate.set(key, [...(byAggregate.get(key) ?? []), node.id]);
  }
  const groups: ErGrouping[] = [];
  for (const [aggregate, ids] of byAggregate) {
    groups.push({
      id: aggregate ?? UNGROUPED,
      name: aggregate ? nameOf(aggregate) : UNGROUPED,
      aggregate,
      nodes: ids,
    });
  }
  groups.sort((a, b) => {
    if (a.aggregate === null) return 1;
    if (b.aggregate === null) return -1;
    return b.nodes.length - a.nodes.length || a.id.localeCompare(b.id);
  });
  return groups;
}

/** Whether a schema is big enough, and grouped enough, for the two-step layout to help. */
export function canGroup(spec: ErSpec): boolean {
  if (spec.nodes.length < GROUP_MIN_TABLES) return false;
  const aggregates = new Set(spec.nodes.map((n) => n.aggregate).filter((a): a is string => a !== null));
  return aggregates.size >= GROUP_MIN_GROUPS;
}

export interface ErLayoutOptions {
  /** Lay the cards out by model group and pack the groups. */
  grouped?: boolean;
  /** Width over height of the box the picture is for; the packing aims at it. */
  aspectRatio?: number;
  /** What a group is called on its frame, by the aggregate it is. */
  nameOf?: (aggregate: string) => string;
}

/** Lays a spec out left to right, roots first. Falls back to a column on failure. */
export async function layoutEr(spec: ErSpec, options: ErLayoutOptions = {}): Promise<ErLayout> {
  const input = layoutInput(spec);
  if (input.nodes.length === 0) {
    return { positions: {}, width: 0, height: 0, groups: [] };
  }

  if (options.grouped) {
    const nameOf = options.nameOf ?? ((aggregate: string) => aggregate.split(".").at(-1) ?? aggregate);
    const groups = groupsOf(spec.nodes, nameOf);
    const groupOf = new Map<string, string>();
    for (const group of groups) {
      for (const id of group.nodes) groupOf.set(id, group.id);
    }
    const sizes = new Map(input.nodes.map((n) => [n.id, n]));
    const result = await layoutGroupsWithElk({
      groups: groups.map((group) => ({
        id: group.id,
        nodes: group.nodes.map((id) => sizes.get(id)).filter((n): n is NonNullable<typeof n> => n !== undefined),
        edges: input.edges.filter((e) => groupOf.get(e.source) === group.id && groupOf.get(e.target) === group.id),
      })),
      aspectRatio: options.aspectRatio ?? 2,
      layerSpacing: 120,
      nodeSpacing: 24,
    });
    return {
      positions: result.positions,
      width: result.width,
      height: result.height,
      groups: groups.map((group) => {
        const frame = result.frames[group.id] ?? { x: 0, y: 0, width: 0, height: 0 };
        return { id: group.id, name: group.name, aggregate: group.aggregate, count: group.nodes.length, ...frame };
      }),
    };
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
  return { positions, width, height, groups: [] };
}
