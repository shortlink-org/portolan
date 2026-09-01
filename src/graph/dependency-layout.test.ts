// The acceptance criteria for the canvas, as assertions.
//
// Everything here is geometry, and geometry is the part of a diagram that is
// usually only ever checked by looking at it. Looking at it does not scale to
// forty services, and it does not run in CI.

import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { eventGraph, filterEventGraph } from "../lib/event-graph";
import { thinCatalog, wideCatalog } from "../lib/scenarios";
import { SIMPLEX_BUDGET, budgeted, layoutDependencyGraph } from "./dependency-layout";
import type { Layout } from "./dependency-layout";
import { midpoint, offsetInterior, roundedPath } from "./elk";
import type { Point } from "./elk";
import { SERVICE_H, SERVICE_W } from "./theme";

const sample = eventGraph(catalog);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxes(layout: Layout): Box[] {
  return layout.nodes.map((n) => ({
    x: n.position.x,
    y: n.position.y,
    w: n.width ?? SERVICE_W,
    h: n.height ?? SERVICE_H,
  }));
}

function inside(p: Point, box: Box, pad = 0): boolean {
  return (
    p.x > box.x - pad &&
    p.x < box.x + box.w + pad &&
    p.y > box.y - pad &&
    p.y < box.y + box.h + pad
  );
}

/** Shortest distance from `p` to the segment a-b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far apart two polylines stay, sampled along both. */
function separation(a: readonly Point[], b: readonly Point[]): number {
  let worst = Number.POSITIVE_INFINITY;
  const sample = (from: readonly Point[], to: readonly Point[]) => {
    for (const p of from) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 1; i < to.length; i += 1) {
        const s = to[i - 1];
        const e = to[i];
        if (s && e) best = Math.min(best, distanceToSegment(p, s, e));
      }
      worst = Math.min(worst, best);
    }
  };
  sample(a, b);
  sample(b, a);
  return worst;
}

function key(points: readonly Point[]): string {
  return points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
}

/**
 * A layout, and the quickest of `runs` goes at producing it.
 *
 * The frame budget below is a claim about elk, and a single wall-clock reading
 * taken inside a suite running fifty files across every core is not: a run
 * that happens to land while the other workers are busy measures the
 * scheduler. Timing it more than once and keeping the best cancels some of
 * that, and cancels nothing real.
 */
async function fastest(
  runs: number,
  run: () => Promise<Layout>,
): Promise<{ layout: Layout; elapsed: number }> {
  let layout = await run();
  let elapsed = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    layout = await run();
    elapsed = Math.min(elapsed, performance.now() - started);
  }
  return { layout, elapsed };
}

describe("the sample, laid out", () => {
  it("routes every edge and gives every node a place", async () => {
    const layout = await layoutDependencyGraph(sample, "bipartite");
    expect(layout.nodes.length).toBe(
      sample.services.length + sample.events.length,
    );
    for (const edge of layout.edges) {
      expect(edge.data?.points.length, edge.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("never overlaps two boxes", async () => {
    const layout = await layoutDependencyGraph(sample, "bipartite");
    const all = boxes(layout);
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i];
        const b = all[j];
        if (!a || !b) continue;
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${i} overlaps ${j}`).toBe(false);
      }
    }
  });

  it("gives no two edges the same path", async () => {
    for (const mode of ["bipartite", "compact"] as const) {
      const layout = await layoutDependencyGraph(sample, mode);
      const seen = new Map<string, string>();
      for (const edge of layout.edges) {
        const k = key(edge.data?.points ?? []);
        expect(seen.get(k), `${mode}: ${edge.id} retraces ${seen.get(k)}`).toBe(
          undefined,
        );
        seen.set(k, edge.id);
      }
    }
  });

  it("leaves every node by its east side and arrives at the west", async () => {
    const layout = await layoutDependencyGraph(sample, "bipartite");
    const byId = new Map(
      layout.nodes.map((n) => [
        n.id,
        {
          x: n.position.x,
          y: n.position.y,
          w: n.width ?? SERVICE_W,
          h: n.height ?? SERVICE_H,
        },
      ]),
    );
    for (const edge of layout.edges) {
      const points = edge.data?.points ?? [];
      const from = byId.get(edge.source);
      const to = byId.get(edge.target);
      const start = points[0];
      const end = points[points.length - 1];
      if (!from || !to || !start || !end) continue;
      // Ports are pinned to the sides, so the line leaves the right-hand edge
      // of its source and lands on the left-hand edge of its target - never at
      // some point elk found convenient on the top of a box.
      expect(Math.abs(start.x - (from.x + from.w)), edge.id).toBeLessThan(2);
      expect(Math.abs(end.x - to.x), edge.id).toBeLessThan(2);
    }
  });

  it("never draws a loop, even for a service consuming its own event", async () => {
    const layout = await layoutDependencyGraph(sample, "bipartite");
    expect(layout.edges.some((e) => e.source === e.target)).toBe(false);
  });

  it("keeps a bundle's count chip off every box", async () => {
    const layout = await layoutDependencyGraph(sample, "compact");
    const all = boxes(layout);
    for (const edge of layout.edges) {
      if (!edge.data?.chip) continue;
      const at = edge.data.chipAt ?? midpoint(edge.data.points);
      for (const box of all) {
        // 4px of slack: the chip has a border of its own and sits over the
        // line, not over the box the line is going to.
        expect(inside(at, box, 4), `${edge.id} chip lands on a box`).toBe(false);
      }
    }
  });

  it("separates the two lines of a two-way pair", async () => {
    const layout = await layoutDependencyGraph(sample, "compact");
    const there = layout.edges.find(
      (e) => e.source === "shop.oms" && e.target === "payments.ledger",
    );
    const back = layout.edges.find(
      (e) => e.source === "payments.ledger" && e.target === "shop.oms",
    );
    expect(there).toBeDefined();
    expect(back).toBeDefined();
    expect(
      separation(there?.data?.points ?? [], back?.data?.points ?? []),
    ).toBeGreaterThan(0);
  });

  it("gives payments.ledger and delivery.core one bundle of three", async () => {
    const layout = await layoutDependencyGraph(sample, "compact");
    const edge = layout.edges.find(
      (e) => e.source === "payments.ledger" && e.target === "delivery.core",
    );
    expect(edge?.data?.chip).toBe("3");

    // And in the other mode, three pills - one per event, distinct boxes.
    const pills = await layoutDependencyGraph(sample, "bipartite");
    const names = ["PaymentAuthorized", "PaymentCaptured", "RefundIssued"];
    const found = pills.nodes.filter(
      (n) => n.type === "event" && names.includes(String(n.data["label"])),
    );
    expect(found).toHaveLength(3);
    expect(new Set(found.map((n) => `${n.position.x},${n.position.y}`)).size).toBe(3);
  });
});

describe("the thin estate, laid out", () => {
  it("puts three pills to the right of the one service", async () => {
    const layout = await layoutDependencyGraph(eventGraph(thinCatalog()), "bipartite");
    const service = layout.nodes.find((n) => n.type === "service");
    const pills = layout.nodes.filter((n) => n.type === "event");
    expect(pills).toHaveLength(3);
    for (const pill of pills) {
      expect(pill.position.x).toBeGreaterThan(service?.position.x ?? 0);
    }
    // Three lines out, none in.
    expect(layout.edges).toHaveLength(3);
  });
});

/**
 * How long the wide estate may take, in milliseconds.
 *
 * Laid warm on an idle machine it takes 116-161ms bipartite and 62-91ms
 * compact, so 300 looked like ample headroom and is not: this suite runs fifty
 * files across every core, and a laptop that is also building something else
 * puts the same work at 300-380ms with elk doing nothing differently. Timing
 * the best of three runs does not fix that, because under load every run is
 * slow. Measured here at twenty-four busy cores, the reading is 384ms.
 *
 * So the ceiling is set where only the cliff can cross it. The regression this
 * ever guarded is NETWORK_SIMPLEX let loose at this size, and that is 2.2
 * SECONDS on an idle machine - it does not squeak past 1000ms on a busy one,
 * it misses by five times over. Which side of the cliff this graph falls on is
 * asserted exactly, without a stopwatch, in "the budget that keeps elk
 * affordable" below; this number is only here to catch a slow path that
 * `budgeted` cannot see.
 */
const FRAME_BUDGET_MS = 1000;

describe("the budget that keeps elk affordable", () => {
  it("puts the wide estate on the heuristic side of the cliff", async () => {
    const layout = await layoutDependencyGraph(eventGraph(wideCatalog()), "bipartite");
    const size = layout.nodes.length + layout.edges.length;
    expect(size).toBeGreaterThan(SIMPLEX_BUDGET);
    expect(budgeted(layout.nodes.length, layout.edges.length)).toMatchObject({
      nodePlacement: "BRANDES_KOEPF",
      considerModelOrder: false,
    });
  });

  it("leaves the sample on the exact side", async () => {
    const layout = await layoutDependencyGraph(sample, "bipartite");
    const size = layout.nodes.length + layout.edges.length;
    expect(size).toBeLessThanOrEqual(SIMPLEX_BUDGET);
    expect(budgeted(layout.nodes.length, layout.edges.length)).toMatchObject({
      nodePlacement: "NETWORK_SIMPLEX",
      considerModelOrder: true,
    });
  });
});

describe("the wide estate, laid out", () => {
  it("lays 120 nodes out inside the frame budget", async () => {
    const graph = eventGraph(wideCatalog());
    const { layout, elapsed } = await fastest(3, () =>
      layoutDependencyGraph(graph, "bipartite"),
    );
    expect(layout.nodes.length).toBeGreaterThan(120);
    expect(elapsed).toBeLessThan(FRAME_BUDGET_MS);
  });

  it("lays its compact form out too", async () => {
    const graph = eventGraph(wideCatalog());
    const { layout, elapsed } = await fastest(3, () =>
      layoutDependencyGraph(graph, "compact"),
    );
    expect(elapsed).toBeLessThan(FRAME_BUDGET_MS);
    const seen = new Set(layout.edges.map((e) => key(e.data?.points ?? [])));
    expect(seen.size).toBe(layout.edges.length);
  });

  it("survives a filter that empties most of it", async () => {
    const graph = filterEventGraph(eventGraph(wideCatalog()), {
      contexts: new Set(["ctx0"]),
      statuses: new Set(["verified"] as const),
    });
    const layout = await layoutDependencyGraph(graph, "bipartite");
    expect(layout.nodes.length).toBeGreaterThan(0);
  });
});

describe("drawing what elk answered", () => {
  it("rounds a corner without overshooting a short segment", () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 40 },
    ]);
    expect(d.startsWith("M 0,0")).toBe(true);
    expect(d).toContain("Q");
    // The arc cannot eat more than half the 4px segment it turns out of.
    expect(d).toContain("L 2,0");
  });

  it("draws a two-point route as a plain line", () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(
      "M 0,0 L 10,10",
    );
  });

  it("finds the half-way point of a bent route", () => {
    expect(
      midpoint([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual({ x: 10, y: 0 });
  });

  it("moves a route's middle and leaves its ends on their ports", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const moved = offsetInterior(points, 12);
    expect(moved[0]).toEqual({ x: 0, y: 0 });
    expect(moved[2]).toEqual({ x: 10, y: 0 });
    expect(moved[1]).toEqual({ x: 5, y: 12 });
  });

  it("bows a straight run that has no middle to move", () => {
    const moved = offsetInterior(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      -12,
    );
    expect(moved).toHaveLength(3);
    expect(moved[1]).toEqual({ x: 5, y: -12 });
  });
});
