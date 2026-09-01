// From an EventGraph to something React Flow can draw, with elk in between.
//
// Pure and async, and deliberately outside React: the acceptance criteria for
// this canvas are about geometry - no two edges sharing a path, a 40-service
// estate laid out inside a frame budget - and geometry is only assertable if
// producing it does not need a DOM.

import { MarkerType } from "@xyflow/react";
import type { Status } from "../catalog";
import type { Bundle, EventGraph } from "../lib/event-graph";
import { bundles } from "../lib/event-graph";
import { contextVar } from "../lib/context-color";
import { layoutWithElk, midpoint, offsetInterior } from "./elk";
import type { Point } from "./elk";
import type { DependencyNode } from "./DependencyNodes";
import type { RoutedEdgeType } from "./RoutedEdge";
import {
  EVENT_H,
  SERVICE_H,
  SERVICE_W,
  eventWidth,
  statusColor,
  statusDash,
} from "./theme";

export type GraphMode = "bipartite" | "compact";

/** Node id for an event. Prefixed so it cannot collide with a service id. */
export const EVENT_NODE = (eventId: string): string => `event:${eventId}`;

/** The catalog id behind a node id, which is what a selection is made of. */
export function catalogIdOf(nodeId: string): string {
  return nodeId.startsWith("event:") ? nodeId.slice(6) : nodeId;
}

export interface Layout {
  nodes: DependencyNode[];
  edges: RoutedEdgeType[];
}

const ARROW = { type: MarkerType.ArrowClosed, width: 12, height: 12 } as const;

/** How far apart the two lines of a two-way pair are pushed. */
const PAIR_OFFSET = 12;

/*
 * Why the canvas does NOT ask elk to fold its layers.
 *
 * A left-to-right layered graph with an event node between every pair of
 * services doubles its own layer count: the sample estate comes out 2060x309,
 * a ribbon seven times wider than it is tall, in a pane less than twice as
 * wide as it is tall. elk has an answer for that - MULTI_EDGE wrapping with an
 * aspect ratio - and it works: the same graph folds to 1858x657.
 *
 * It was tried, and it is not worth it. Folding a chain into bands means every
 * edge crossing the fold runs the full width of the canvas backwards, and the
 * sample gains eight of those: a bus of long parallel dashed lines through the
 * middle of the picture, in exchange for whitespace above and below it.
 * Whitespace costs a reader nothing. A line they cannot follow does.
 *
 * So the ribbon stays a ribbon, fitView fits its width, and the toolbar zoom
 * is one click away. Written down because "it does not fill the frame" looks
 * like an oversight and is a decision.
 */


/**
 * The size past which elk's best answers stop being affordable.
 *
 * Two options cost real time and both are worth it on an estate a reader can
 * hold in their head. NETWORK_SIMPLEX solves for straight edges rather than
 * approximating them; considerModelOrder is what puts a pill at the height of
 * the service that emits it. Measured on this app's own graphs, at 30 nodes
 * the pair costs 11ms and at 60 nodes 30ms - free, at the sizes where they
 * make the most difference.
 *
 * Past about a hundred nodes-and-edges neither degrades, they fall off a
 * cliff. The sample's own shape scaled to forty services is 128 nodes and 248
 * edges, and there NETWORK_SIMPLEX takes 2.2 SECONDS against 160ms for the
 * heuristic answering the same question, while model order alone adds another
 * 170ms. A layout nobody waits for is not a better layout - and at that size
 * the canvas is at a fit zoom where the pills have collapsed to icons anyway,
 * so the ordering being bought is ordering nobody can read.
 *
 * Above the line, then: BRANDES_KOEPF, less crossing work, no model order.
 * Everything else - ports, spacing, routing - is identical either side of it.
 */
const SIMPLEX_BUDGET = 120;

/** The layout options a graph of this size can pay for. */
function budgeted(
  nodes: number,
  edges: number,
): Pick<
  Parameters<typeof layoutWithElk>[0],
  "nodePlacement" | "thoroughness" | "considerModelOrder"
> {
  return nodes + edges <= SIMPLEX_BUDGET
    ? { nodePlacement: "NETWORK_SIMPLEX", considerModelOrder: true }
    : { nodePlacement: "BRANDES_KOEPF", thoroughness: 2, considerModelOrder: false };
}

export async function layoutDependencyGraph(
  graph: EventGraph,
  mode: GraphMode,
): Promise<Layout> {
  return mode === "compact" ? compact(graph) : bipartite(graph);
}

// ---------------------------------------------------------------------------
// Bipartite: services and events both as nodes.
// ---------------------------------------------------------------------------

async function bipartite(graph: EventGraph): Promise<Layout> {
  const present = new Set(graph.services.map((s) => s.id));

  // Services first, then events in publisher order. elk breaks ties inside a
  // layer by this order, which is what puts a pill at the height of the box
  // that emits it.
  const sized = [
    ...graph.services.map((s) => ({
      id: s.id,
      width: SERVICE_W,
      height: SERVICE_H,
    })),
    ...graph.events.map((e) => ({
      id: EVENT_NODE(e.id),
      width: eventWidth(e.name, e.consumers.some((c) => c.self) ? 34 : 0),
      height: EVENT_H,
    })),
  ];

  const specs: {
    id: string;
    source: string;
    target: string;
    kind: "publish" | "consume";
    status: Status;
    context: string | null;
    eventId: string;
  }[] = [];
  for (const event of graph.events) {
    if (present.has(event.publisher)) {
      specs.push({
        id: `pub:${event.id}`,
        source: event.publisher,
        target: EVENT_NODE(event.id),
        kind: "publish",
        status: "verified",
        context: event.context,
        eventId: event.id,
      });
    }
    for (const consumer of event.consumers) {
      // Self-consumption is a chip on the pill. Never a loop.
      if (consumer.self || !present.has(consumer.service)) continue;
      specs.push({
        id: `con:${event.id}->${consumer.service}`,
        source: EVENT_NODE(event.id),
        target: consumer.service,
        kind: "consume",
        status: consumer.status,
        context: event.context,
        eventId: event.id,
      });
    }
  }

  const { positions, routes } = await layoutWithElk({
    nodes: sized,
    edges: specs.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    direction: "RIGHT",
    layerSpacing: 96,
    nodeSpacing: 32,
    ports: true,
    // Splines, because between every pair of services there is now a node, and
    // right angles around a node that small read as a maze.
    edgeRouting: "SPLINES",
    ...budgeted(sized.length, specs.length),
  });

  const byId = new Map(sized.map((n) => [n.id, n]));
  const nodes: DependencyNode[] = [
    ...graph.services.map(
      (s): DependencyNode => ({
        id: s.id,
        type: "service",
        position: positions[s.id] ?? { x: 0, y: 0 },
        data: {
          kind: "service",
          label: s.label,
          context: s.context,
          ghost: s.ghost,
          publishes: s.publishes,
          consumes: s.consumes,
        },
        ...box(byId.get(s.id)),
      }),
    ),
    ...graph.events.map((e): DependencyNode => {
      const id = EVENT_NODE(e.id);
      return {
        id,
        type: "event",
        position: positions[id] ?? { x: 0, y: 0 },
        data: {
          kind: "event",
          label: e.name,
          context: e.context,
          eventId: e.id,
          publisher: e.publisher,
          self: e.consumers.some((c) => c.self),
        },
        ...box(byId.get(id)),
      };
    }),
  ];

  const edges: RoutedEdgeType[] = specs.map((spec) => {
    const publish = spec.kind === "publish";
    // A publish line is not a claim about observation - the service emits the
    // event, that is what the event IS - so it is always solid, and it carries
    // the publisher's colour rather than a status colour it has no status for.
    const color = publish ? contextVar(spec.context) : statusColor(spec.status);
    const dash = publish ? undefined : statusDash(spec.status);
    return {
      id: spec.id,
      source: spec.source,
      target: spec.target,
      type: "routed",
      style: {
        stroke: color,
        strokeWidth: 1.3,
        ...(dash ? { strokeDasharray: dash } : {}),
      },
      // No arrowhead on a publish line: the pill it lands on is unmistakably
      // the far end, and a head on every one of them doubles the ink.
      ...(publish ? {} : { markerEnd: { ...ARROW, color } }),
      data: { points: routes[spec.id] ?? [], eventId: spec.eventId, kind: spec.kind },
    };
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Compact: services only, one bundled edge per ordered pair.
// ---------------------------------------------------------------------------

async function compact(graph: EventGraph): Promise<Layout> {
  const pairs = bundles(graph);

  const sized = graph.services.map((s) => ({
    id: s.id,
    width: SERVICE_W,
    height: SERVICE_H,
  }));

  const { positions, routes } = await layoutWithElk({
    nodes: sized,
    edges: pairs.map((b) => ({ id: b.id, source: b.from, target: b.to })),
    direction: "RIGHT",
    layerSpacing: 96,
    nodeSpacing: 32,
    ports: true,
    // Right angles: with no node between two services, an orthogonal route is
    // the one a reader can follow with a finger.
    edgeRouting: "ORTHOGONAL",
    ...budgeted(sized.length, pairs.length),
  });

  const nodes: DependencyNode[] = graph.services.map((s) => ({
    id: s.id,
    type: "service",
    position: positions[s.id] ?? { x: 0, y: 0 },
    data: {
      kind: "service",
      label: s.label,
      context: s.context,
      ghost: s.ghost,
      publishes: s.publishes,
      consumes: s.consumes,
    },
    ...box({ width: SERVICE_W, height: SERVICE_H }),
  }));

  // Where the chips may not go. A route around the back of the graph has its
  // half-way point somewhere over the middle of it, and a number printed on a
  // service box is a number attached to the wrong thing.
  const occupied = graph.services.map((s) => ({
    ...(positions[s.id] ?? { x: 0, y: 0 }),
    w: SERVICE_W,
    h: SERVICE_H,
  }));

  const edges: RoutedEdgeType[] = pairs.map((bundle) => {
    const color = statusColor(bundle.status);
    const dash = statusDash(bundle.status);
    const points = separate(bundle, routes[bundle.id] ?? []);
    return {
      id: bundle.id,
      source: bundle.from,
      target: bundle.to,
      type: "routed",
      style: {
        stroke: color,
        strokeWidth: 1.4,
        ...(dash ? { strokeDasharray: dash } : {}),
      },
      markerEnd: { ...ARROW, color },
      data: {
        points,
        chip: String(bundle.events.length),
        chipAt: chipPosition(points, occupied),
        chipTitle: bundleTitle(bundle),
        selectId: bundle.id,
        bundleId: bundle.id,
      },
    };
  });

  return { nodes, edges };
}

/** Both directions of a two-way pair, pushed apart so neither hides the other. */
function separate(bundle: Bundle, points: readonly Point[]): Point[] {
  if (!bundle.back || points.length === 0) return [...points];
  // Lexicographic, so the pair splits the same way whichever edge is built
  // first and whichever way round elk chose to route them.
  const dy = bundle.from < bundle.to ? -PAIR_OFFSET : PAIR_OFFSET;
  return offsetInterior(points, dy);
}

interface Box extends Point {
  w: number;
  h: number;
}

/** 6px of air around a chip, so it clears a box rather than touching it. */
const CHIP_CLEARANCE = 6;

/**
 * The half-way point of the route, or the clearest point on it if that lands
 * on a box.
 *
 * Most routes are fine at the middle. The ones that are not are the back edges
 * - the line from a service in a later layer to one in an earlier layer runs
 * around the outside of everything between them, and its middle is over the
 * part of the canvas that is most crowded. Rather than nudge the chip and hope,
 * the route is walked and the point furthest from every box wins.
 */
function chipPosition(
  points: readonly Point[],
  boxes: readonly Box[],
): Point {
  const middle = midpoint(points);
  if (clearance(middle, boxes) > CHIP_CLEARANCE) return middle;

  let best = middle;
  let bestClearance = clearance(middle, boxes);
  // Twenty samples is one every few percent of the route: finer than the eye
  // and coarse enough to be free.
  for (let i = 1; i < 20; i += 1) {
    const at = along(points, i / 20);
    const room = clearance(at, boxes);
    if (room > bestClearance) {
      best = at;
      bestClearance = room;
    }
  }
  return best;
}

/** Distance from a point to the nearest box, negative when inside one. */
function clearance(p: Point, boxes: readonly Box[]): number {
  let least = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.w));
    const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.h));
    const outside = Math.hypot(dx, dy);
    least = Math.min(least, dx === 0 && dy === 0 ? -1 : outside);
  }
  return least;
}

/** The point a given fraction of the way along a polyline. */
function along(points: readonly Point[], t: number): Point {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  let walked = 0;
  const want = total * t;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + len >= want) {
      const f = len === 0 ? 0 : (want - walked) / len;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    walked += len;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

function bundleTitle(bundle: Bundle): string {
  return bundle.events.map((e) => `${e.name} (${e.status})`).join("\n");
}

/**
 * Everything React Flow needs to know about a box whose size we already know.
 *
 * `measured` is the load-bearing one. React Flow will not draw an edge until
 * both its ends have been measured, and it measures with a ResizeObserver on
 * the rendered element - so a canvas that mounts inside a pane which is
 * momentarily zero-height comes up with every node in place and not one line
 * between them, and stays that way, because the nodes never change size again
 * and the observer never fires twice. Every node here is a fixed size decided
 * before elk ran. Saying so removes the timing question entirely.
 */
function box(sized: { width: number; height: number } | undefined) {
  const width = sized?.width ?? SERVICE_W;
  const height = sized?.height ?? SERVICE_H;
  return {
    width,
    height,
    initialWidth: width,
    initialHeight: height,
    measured: { width, height },
    draggable: false,
    connectable: false,
  };
}
