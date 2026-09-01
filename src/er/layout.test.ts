// Layout, on the two catalogs built to break it.
//
// elk itself is not under test here. What is: that the graph handed to it says
// what we mean — roots first, one constraint per relationship, no self-edges —
// and that it survives an estate too big to draw and a schema shaped wrong.

import { describe, expect, it } from "vitest";
import { buildIndex, validateCatalog } from "../catalog";
import { pathologicalCatalog, wideCatalog } from "../lib/scenarios";
import { erSpec } from "./spec";
import { layoutEr, layoutInput } from "./layout";

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
    expect(result).toEqual({ positions: {}, width: 0, height: 0 });
  });
});

describe("the wide estate", () => {
  const wide = wideCatalog();

  it("validates, which is the first thing a scenario has to do", () => {
    expect(() => validateCatalog(wide)).not.toThrow();
  });

  it("is the size it claims to be", () => {
    expect(wide.stores).toHaveLength(30);
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
