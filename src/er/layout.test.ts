// Layout, on the two catalogs built to break it.
//
// elk itself is not under test here. What is: that the graph handed to it says
// what we mean — roots first, one constraint per relationship, no self-edges —
// and that it survives an estate too big to draw and a schema shaped wrong.

import { describe, expect, it } from "vitest";
import { buildIndex, validateCatalog } from "../catalog";
import { pathologicalCatalog, wideCatalog } from "../lib/scenarios";
import { erSpec } from "./spec";
import type { ErNode, ErSpec } from "./spec";
import { canGroup, groupsOf, hideGroups, layoutEr, layoutInput } from "./layout";

describe("layoutInput", () => {
  const bad = pathologicalCatalog();
  const index = buildIndex(validateCatalog(bad));
  const store = (bad.stores ?? [])[0];
  if (!store) throw new Error("scenario has no store");
  const spec = erSpec(index, store, { mode: "keys" });
  const input = layoutInput(spec);

  it("reverses every edge, so the table pointed AT is laid out first", () => {
    // The drawn edge runs child → parent. Laid out that way, the aggregate
    // root ends up at the far right, which is the opposite of how a schema is
    // read.
    const drawn = spec.edges.find(
      (e) => e.from === "edge.core.pg.a" && e.to === "edge.core.pg.b",
    );
    expect(drawn).toBeDefined();
    expect(
      input.edges.some(
        (e) => e.source === "edge.core.pg.b" && e.target === "edge.core.pg.a",
      ),
    ).toBe(true);
  });

  it("drops a self-reference, which constrains nothing", () => {
    expect(
      input.edges.some((e) => e.source === e.target),
    ).toBe(false);
  });

  it("keeps every table as a node, self-referencing or not", () => {
    expect(input.nodes.map((n) => n.id).sort()).toEqual(
      spec.nodes.map((n) => n.id).sort(),
    );
  });

  it("collapses two keys between the same pair into one constraint", () => {
    const pairs = input.edges.map((e) => `${e.source}->${e.target}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("layoutEr", () => {
  it("places every table in the pathological store, cycle and all", async () => {
    const bad = pathologicalCatalog();
    const index = buildIndex(validateCatalog(bad));
    const store = (bad.stores ?? [])[0];
    if (!store) throw new Error("scenario has no store");
    const spec = erSpec(index, store, { mode: "all" });

    const { positions } = await layoutEr(spec);
    for (const node of spec.nodes) {
      expect(positions[node.id]).toBeDefined();
    }
  });

  it("puts a chain's first table left of its last", async () => {
    const wide = wideCatalog();
    const index = buildIndex(validateCatalog(wide));
    const store = (wide.stores ?? [])[0];
    if (!store) throw new Error("scenario has no store");
    const spec = erSpec(index, store, { mode: "keys" });

    const { positions } = await layoutEr(spec);
    const first = positions[`${store.id}.t0`];
    const last = positions[`${store.id}.t5`];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first?.x ?? 0).toBeLessThan(last?.x ?? 0);
  });

  it("answers for an empty store without asking elk anything", async () => {
    const result = await layoutEr({ nodes: [], edges: [] });
    expect(result).toEqual({ positions: {}, width: 0, height: 0, groups: [] });
  });
});

describe("grouping a big schema", () => {
  /** A card with only what grouping and packing read off it. */
  const card = (id: string, aggregate: string | null): ErNode =>
    ({ id, aggregate, width: 208, height: 120, name: id.split(".").at(-1) }) as unknown as ErNode;
  /** `count` tables over `aggregates` groups, plus `loose` that persist nothing. */
  const schema = (count: number, aggregates: string[], loose = 0): ErSpec => {
    const nodes: ErNode[] = [];
    for (let i = 0; i < count; i += 1) {
      nodes.push(card(`s.t${i}`, aggregates[i % aggregates.length] ?? null));
    }
    for (let i = 0; i < loose; i += 1) nodes.push(card(`s.l${i}`, null));
    return { nodes, edges: [] };
  };

  it("groups the cards by the model they persist, biggest first, the loose ones last", () => {
    const spec = schema(7, ["a.big", "a.small", "a.big"], 2);
    const groups = groupsOf(spec.nodes, (a) => a.split(".").at(-1)?.toUpperCase() ?? a);
    expect(groups.map((g) => `${g.name}:${g.nodes.length}`)).toEqual(["BIG:5", "SMALL:2", "other:2"]);
    expect(groups[2]?.aggregate).toBeNull();
  });

  it("offers grouping only past the size where one flow becomes a column", () => {
    expect(canGroup(schema(39, ["a", "b", "c"]))).toBe(false);
    expect(canGroup(schema(60, ["a", "b"]))).toBe(false);
    expect(canGroup(schema(60, ["a", "b", "c"]))).toBe(true);
    // Loose tables count as size but not as a group.
    expect(canGroup(schema(10, ["a", "b", "c"], 40))).toBe(true);
    expect(canGroup(schema(10, ["a", "b"], 40))).toBe(false);
  });

  it("packs the groups and keeps every card inside its own frame", async () => {
    const spec = schema(48, ["a.x", "a.y", "a.z"], 6);
    // A key inside a group and one across, which the packing ignores.
    spec.edges.push(
      { id: "in", kind: "fk", from: "s.t3", to: "s.t0", fromColumn: "x_id", toColumn: "id", onDelete: null } as unknown as ErSpec["edges"][number],
      { id: "across", kind: "fk", from: "s.t1", to: "s.t0", fromColumn: "x_id", toColumn: "id", onDelete: null } as unknown as ErSpec["edges"][number],
    );
    const laid = await layoutEr(spec, { grouped: true, aspectRatio: 2 });
    expect(laid.groups.map((g) => g.id)).toEqual(["a.x", "a.y", "a.z", "other"]);
    for (const node of spec.nodes) {
      const at = laid.positions[node.id];
      expect(at).toBeDefined();
      const frame = laid.groups.find((g) => g.id === (node.aggregate ?? "other"));
      expect(frame).toBeDefined();
      if (!at || !frame) continue;
      expect(at.x).toBeGreaterThanOrEqual(frame.x);
      expect(at.y).toBeGreaterThanOrEqual(frame.y);
      expect(at.x + node.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
      expect(at.y + node.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
    }
    // Frames do not overlap.
    for (const a of laid.groups) {
      for (const b of laid.groups) {
        if (a.id === b.id) continue;
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
    // Packed near the box's shape rather than as a column.
    expect(laid.width / laid.height).toBeGreaterThan(1);
    // The key inside a group put its parent left of its child.
    expect(laid.positions["s.t0"]?.x ?? 0).toBeLessThan(laid.positions["s.t3"]?.x ?? 0);
  });

  it("hides a group with every edge that touched it, and leaves the rest as it was", () => {
    const spec = schema(6, ["a.x", "a.y"], 2);
    spec.edges.push(
      { id: "in-x", kind: "fk", from: "s.t2", to: "s.t0", fromColumn: "x_id", toColumn: "id", onDelete: null } as unknown as ErSpec["edges"][number],
      { id: "x-y", kind: "fk", from: "s.t1", to: "s.t0", fromColumn: "x_id", toColumn: "id", onDelete: null } as unknown as ErSpec["edges"][number],
    );
    expect(hideGroups(spec, new Set())).toBe(spec);
    const without = hideGroups(spec, new Set(["a.y", "other"]));
    expect(without.nodes.map((n) => n.id)).toEqual(["s.t0", "s.t2", "s.t4"]);
    expect(without.edges.map((e) => e.id)).toEqual(["in-x"]);
  });

  it("stays one flow unless asked", async () => {
    const laid = await layoutEr(schema(45, ["a", "b", "c"]));
    expect(laid.groups).toEqual([]);
  });
});

describe("the wide estate", () => {
  const wide = wideCatalog();

  it("validates, which is the first thing a scenario has to do", () => {
    expect(() => validateCatalog(wide)).not.toThrow();
  });

  it("is the size it claims to be", () => {
    expect(wide.stores).toHaveLength(40);
    const tables = (wide.stores ?? []).reduce(
      (n, s) => n + s.tables.length,
      0,
    );
    expect(tables).toBeGreaterThanOrEqual(200);
  });

  it("lays out one of its stores", async () => {
    const index = buildIndex(validateCatalog(wide));
    const store = (wide.stores ?? [])[0];
    if (!store) throw new Error("scenario has no store");
    const { positions, width } = await layoutEr(
      erSpec(index, store, { mode: "all" }),
    );
    expect(Object.keys(positions)).toHaveLength(store.tables.length);
    expect(width).toBeGreaterThan(0);
  });
});
