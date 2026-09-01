// elkjs layout for everything React Flow renders. Async by nature, so callers
// hold the result in state; nothing here touches React.
//
// elk does not just place the boxes. It also ROUTES the lines, and that
// routing is the reason elk is in the stack at all: a bezier drawn between two
// node centres knows nothing about the third node it passes through, and on a
// layered graph it will pass through one. So the sections elk returns come
// back with the positions, and the canvas draws those rather than a curve of
// its own invention.

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";

const elk = new ELK();

export interface Point {
  x: number;
  y: number;
}

export interface LayoutInput {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string; labelWidth?: number }[];
  direction?: "RIGHT" | "DOWN";
  /** extra space between layers; the focused graph wants more than the big one */
  layerSpacing?: number;
  nodeSpacing?: number;
  /**
   * "layered" is a flow: it reads left to right and every edge is a step. The
   * context map is not a flow - it is a map, its edges run both ways, and a
   * layered pass would put a third domain in the middle of the line between
   * the other two. "stress" spreads the nodes in two dimensions instead, and
   * `edgeLength` is how far apart it tries to hold them.
   */
  algorithm?: "layered" | "stress";
  edgeLength?: number;
  /**
   * Give every node one WEST input port and one EAST output port, pinned to
   * those sides. Without it elk is free to attach a line anywhere on the
   * boundary, and a line leaving the top-left corner of a box that is laid out
   * left-to-right reads as a mistake even when the routing is optimal.
   */
  ports?: boolean;
  /**
   * How the lines are drawn. ORTHOGONAL is right angles, which is what a
   * bundled service-to-service edge wants; SPLINES is smooth, which is what a
   * graph with a node between every pair of services wants.
   */
  edgeRouting?: "ORTHOGONAL" | "SPLINES" | "POLYLINE";
  /**
   * How the layers are packed vertically.
   *
   * NETWORK_SIMPLEX is the best answer and by far the most expensive one: it
   * solves for straight edges rather than approximating, and past roughly a
   * hundred nodes-and-edges it goes from milliseconds to seconds. Callers big
   * enough to feel that ask for BRANDES_KOEPF instead, which is the same
   * family of answer computed by heuristic.
   */
  nodePlacement?: "NETWORK_SIMPLEX" | "BRANDES_KOEPF";
  /**
   * How hard elk works at crossing minimisation. elk's own default is 7; the
   * only reason to lower it is a graph too big to afford the default.
   */
  thoroughness?: number;
  /**
   * Break layer ties by the order the caller listed the nodes in. It is what
   * puts an event pill at the height of the service that emits it: the events
   * are listed in publisher order, so within their layer they end up in
   * publisher order too.
   */
  considerModelOrder?: boolean;
}

export interface LayoutResult {
  positions: Record<string, Point>;
  /**
   * Edge id -> the points elk routed it through, start first and end last.
   * Empty for an edge elk chose not to route (it does that for edges it hides
   * inside a self-loop, which this app never asks it to draw).
   */
  routes: Record<string, Point[]>;
  width: number;
  height: number;
}

const IN = (id: string): string => `${id}::in`;
const OUT = (id: string): string => `${id}::out`;

export async function layoutWithElk(input: LayoutInput): Promise<LayoutResult> {
  const children: ElkNode[] = input.nodes.map((n) => ({
    id: n.id,
    width: n.width,
    height: n.height,
    ...(input.ports
      ? {
          layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
          ports: [
            {
              id: IN(n.id),
              width: 1,
              height: 1,
              layoutOptions: { "elk.port.side": "WEST" },
            },
            {
              id: OUT(n.id),
              width: 1,
              height: 1,
              layoutOptions: { "elk.port.side": "EAST" },
            },
          ],
        }
      : {}),
  }));

  const edges: ElkExtendedEdge[] = input.edges.map((e) => ({
    id: e.id,
    sources: [input.ports ? OUT(e.source) : e.source],
    targets: [input.ports ? IN(e.target) : e.target],
    ...(e.labelWidth
      ? { labels: [{ text: "", width: e.labelWidth, height: 14 }] }
      : {}),
  }));

  const stress = input.algorithm === "stress";
  const graph: ElkNode = {
    id: "root",
    layoutOptions: stress
      ? {
          "elk.algorithm": "stress",
          "elk.stress.desiredEdgeLength": String(input.edgeLength ?? 320),
          "elk.spacing.nodeNode": String(input.nodeSpacing ?? 60),
          "elk.padding": "[top=16,left=16,bottom=16,right=16]",
        }
      : {
          "elk.algorithm": "layered",
          "elk.direction": input.direction ?? "RIGHT",
          // Every node is a peer; nothing here nests, so there are no children
          // to lay out inside a parent.
          "elk.hierarchyHandling": "SEPARATE_CHILDREN",
          "elk.layered.spacing.nodeNodeBetweenLayers": String(
            input.layerSpacing ?? 130,
          ),
          "elk.spacing.nodeNode": String(input.nodeSpacing ?? 34),
          "elk.layered.spacing.edgeNodeBetweenLayers": "24",
          "elk.spacing.edgeLabel": "6",
          "elk.layered.nodePlacement.strategy":
            input.nodePlacement ?? "NETWORK_SIMPLEX",
          ...(input.thoroughness
            ? { "elk.layered.thoroughness": String(input.thoroughness) }
            : {}),
          "elk.layered.crossingMinimization.semiInteractive": "true",
          ...(input.considerModelOrder
            ? {
                "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
              }
            : {}),
          ...(input.edgeRouting
            ? { "elk.edgeRouting": input.edgeRouting }
            : {}),
          "elk.padding": "[top=16,left=16,bottom=16,right=16]",
        },
    children,
    edges,
  };

  const laid = await elk.layout(graph);
  const positions: Record<string, Point> = {};
  for (const child of laid.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }

  const routes: Record<string, Point[]> = {};
  for (const edge of (laid.edges ?? []) as ElkExtendedEdge[]) {
    const points: Point[] = [];
    for (const section of edge.sections ?? []) {
      // Sections chain: the end of one is the start of the next, so the shared
      // point is written once.
      if (points.length === 0) points.push(section.startPoint);
      for (const bend of section.bendPoints ?? []) points.push(bend);
      points.push(section.endPoint);
    }
    if (points.length > 0) routes[edge.id] = points;
  }

  return {
    positions,
    routes,
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Drawing what elk answered
// ---------------------------------------------------------------------------

/**
 * A polyline through `points` with its corners rounded off.
 *
 * The radius shrinks to fit: a corner between two short segments gets a small
 * arc rather than one that overshoots into the segment after it, which is what
 * turns a tidy orthogonal route into a knot at exactly the places where the
 * route is densest.
 */
export function roundedPath(points: readonly Point[], radius = 10): string {
  if (points.length === 0) return "";
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M ${first.x},${first.y}`;

  let d = `M ${first.x},${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    if (!prev || !corner || !next) continue;

    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${corner.x},${corner.y}`;
      continue;
    }
    const start = lerp(corner, prev, r / inLen);
    const end = lerp(corner, next, r / outLen);
    d += ` L ${start.x},${start.y} Q ${corner.x},${corner.y} ${end.x},${end.y}`;
  }
  const last = points[points.length - 1];
  if (last) d += ` L ${last.x},${last.y}`;
  return d;
}

function lerp(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** The point half way along a polyline, where a chip or a label goes. */
export function midpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const head = points[0];
  if (!head) return { x: 0, y: 0 };
  if (points.length === 1) return head;

  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + len >= total / 2) {
      const t = len === 0 ? 0 : (total / 2 - walked) / len;
      return lerp(a, b, t);
    }
    walked += len;
  }
  return points[points.length - 1] ?? head;
}

/**
 * Moves the interior of a route sideways, leaving its ends on their ports.
 *
 * Two services that publish to each other get two lines through the same
 * corridor. elk routes them apart when it can and on top of each other when it
 * cannot; nudging one up and the other down guarantees the reader sees two
 * lines whichever elk chose, and keeping the endpoints pinned means neither
 * line detaches from the box it belongs to.
 */
export function offsetInterior(points: readonly Point[], dy: number): Point[] {
  if (points.length <= 2) {
    // A straight run has no interior to move, so it grows one: a single
    // waypoint at the middle, offset, which bows the line clear of its twin.
    const a = points[0];
    const b = points[1];
    if (!a || !b) return [...points];
    return [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + dy }, b];
  }
  return points.map((p, i) =>
    i === 0 || i === points.length - 1 ? p : { x: p.x, y: p.y + dy },
  );
}
