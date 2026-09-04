// Walking the lineage graph: both directions, and no walk that never ends.

import { describe, expect, it } from "vitest";
import { rawCatalog } from "../test-catalog";
import { buildIndex, validateCatalog } from "../catalog";
import type { Catalog } from "../catalog";
import {
  downstreamOf,
  isIsolated,
  lineageChain,
  lineageEdgeId,
  parseLineageEdgeId,
  upstreamOf,
} from "./lineage";
import type { LineageMaps } from "./lineage";

/** A graph written the way a catalog declares it: derived end names its sources. */
function maps(declared: Record<string, string[]>): LineageMaps {
  const from = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const [target, sources] of Object.entries(declared)) {
    from.set(target, sources);
    for (const source of sources) {
      const list = into.get(source) ?? [];
      list.push(target);
      into.set(source, list);
    }
  }
  return { from, into };
}

describe("edge ids", () => {
  it("round-trips", () => {
    const id = lineageEdgeId("db.t.a", "db.v.b");
    expect(id).toBe("db.t.a~>db.v.b");
    expect(parseLineageEdgeId(id)).toEqual({
      source: "db.t.a",
      target: "db.v.b",
    });
  });

  it("is not fooled by something that is not an edge id", () => {
    expect(parseLineageEdgeId("db.t.a")).toBeNull();
    expect(parseLineageEdgeId("~>db.t.a")).toBeNull();
  });
});

describe("walking", () => {
  // t.a -> v.b -> w.c, with v.b also feeding w.d.
  const graph = maps({
    "db.v.b": ["db.t.a"],
    "db.w.c": ["db.v.b"],
    "db.w.d": ["db.v.b"],
  });

  it("follows sources to the far end", () => {
    expect([...upstreamOf(graph, "db.w.c")].sort()).toEqual([
      "db.t.a",
      "db.v.b",
    ]);
  });

  it("follows readers to the far end", () => {
    expect([...downstreamOf(graph, "db.t.a")].sort()).toEqual([
      "db.v.b",
      "db.w.c",
      "db.w.d",
    ]);
  });

  it("says nothing about a column nobody copies", () => {
    expect(upstreamOf(graph, "db.t.a").size).toBe(0);
    expect(downstreamOf(graph, "db.w.c").size).toBe(0);
    expect(isIsolated(graph, "db.z.x")).toBe(true);
    expect(isIsolated(graph, "db.t.a")).toBe(false);
  });

  it("lights the whole chain from anywhere on it, itself included", () => {
    const chain = lineageChain(graph, "db.v.b");
    expect([...chain.columns].sort()).toEqual([
      "db.t.a",
      "db.v.b",
      "db.w.c",
      "db.w.d",
    ]);
    expect([...chain.edges].sort()).toEqual([
      "db.t.a~>db.v.b",
      "db.v.b~>db.w.c",
      "db.v.b~>db.w.d",
    ]);
  });

  it("terminates on a cycle", () => {
    // A catalog mid-migration is allowed to claim a view feeds its own source.
    const cyclic = maps({ "db.v.b": ["db.t.a"], "db.t.a": ["db.v.b"] });
    const chain = lineageChain(cyclic, "db.t.a");
    expect([...chain.columns].sort()).toEqual(["db.t.a", "db.v.b"]);
    expect(chain.edges.size).toBe(2);
  });
});

describe("the catalog's own graph", () => {
  const catalog = validateCatalog(
    JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog,
  );
  const index = buildIndex(catalog);
  const graph: LineageMaps = {
    from: index.lineageFrom,
    into: index.lineageInto,
  };

  it("has lineage to walk at all", () => {
    expect(index.lineageFrom.size).toBeGreaterThan(0);
  });

  it("only ever names columns the catalog has", () => {
    for (const [target, sources] of index.lineageFrom) {
      expect(
        index.columnById.has(target) || index.viewColumnById.has(target),
        target,
      ).toBe(true);
      for (const source of sources) {
        expect(
          index.columnById.has(source) || index.viewColumnById.has(source),
          source,
        ).toBe(true);
      }
    }
  });

  it("reaches a source table from a view column", () => {
    const [first] = [...index.viewColumnById.keys()].filter(
      (id) => (index.lineageFrom.get(id)?.length ?? 0) > 0,
    );
    expect(first).toBeDefined();
    const chain = lineageChain(graph, first as string);
    expect(chain.columns.size).toBeGreaterThan(1);
    expect(chain.edges.size).toBeGreaterThan(0);
  });
});
