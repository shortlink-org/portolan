import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { contextMap } from "./context-map";
import type { ContextRelation, PatternName } from "./context-map";

const map = contextMap(catalog);
const find = (id: string): ContextRelation => {
  const found = map.find((r) => r.id === id);
  if (!found) throw new Error(`no relation ${id}`);
  return found;
};
const names = (relation: ContextRelation): PatternName[] =>
  relation.patterns.map((p) => p.name);

describe("shape", () => {
  it("draws every pair of contexts exactly once, in catalog order", () => {
    const n = catalog.contexts.length;
    expect(map).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(map.map((r) => r.id)).size).toBe(map.length);
    const rank = new Map(catalog.contexts.map((c, i) => [c.id, i]));
    for (const relation of map) {
      expect(rank.get(relation.a)).toBeLessThan(rank.get(relation.b) ?? -1);
    }
  });

  it("puts the pairs that are wired together above the pairs that are not", () => {
    const weights = map.map(
      (r) =>
        r.dependencies.reduce((n, d) => n + d.links.length, 0) +
        r.shared.length,
    );
    expect([...weights].sort((x, y) => y - x)).toEqual(weights);
  });

  it("gives every relation at least one pattern to explain itself", () => {
    for (const relation of map) {
      expect(relation.patterns.length, relation.id).toBeGreaterThan(0);
      for (const pattern of relation.patterns) {
        expect(
          pattern.why.length,
          `${relation.id}/${pattern.name}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("direction", () => {
  it("makes the publisher of an event upstream of everyone who consumes it", () => {
    const shopPayments = find("shop~payments");
    const shopUp = shopPayments.dependencies.find((d) => d.upstream === "shop");
    expect(shopUp?.links.map((l) => l.label)).toContain("OrderPlaced");
  });

  it("makes the ANSWERING side of a call upstream — the caller lives with its model", () => {
    // payments.ledger calls shop.v1.Orders/GetOrder, which shop.oms answers.
    const shopUp = find("shop~payments").dependencies.find(
      (d) => d.upstream === "shop",
    );
    const call = shopUp?.links.find((l) => l.kind === "rpc");
    expect(call?.id).toBe("shop.v1.Orders/GetOrder");
    expect(call?.to).toBe("payments.ledger");
  });

  it("ignores an edge that does not leave the context — a map draws boundaries", () => {
    for (const relation of map) {
      for (const dependency of relation.dependencies) {
        expect(dependency.upstream).not.toBe(dependency.downstream);
      }
    }
  });

  it("ignores a consumer that is not in the catalog — that is a Problem, not a peer", () => {
    // shop.oms.order.OrderPlaced names `analytics-sink`, which owns no context.
    const ids = map.flatMap((r) =>
      r.dependencies.flatMap((d) => d.links.map((l) => l.to)),
    );
    expect(ids).not.toContain("analytics-sink");
  });
});

describe("patterns that are counted", () => {
  it("calls it a partnership when the arrows run both ways", () => {
    const relation = find("shop~payments");
    expect(relation.dependencies).toHaveLength(2);
    expect(names(relation)).toContain("partnership");
    expect(names(relation)).not.toContain("customer-supplier");
  });

  it("names the supplier and the customer when they run one way", () => {
    const relation = find("payments~delivery");
    const pattern = relation.patterns.find(
      (p) => p.name === "customer-supplier",
    );
    expect(pattern?.upstream).toBe("payments");
    expect(pattern?.downstream).toBe("delivery");
    expect(pattern?.basis).toBe("counted");
  });

  it("finds a kernel wherever both domains name the same definition", () => {
    const relation = find("shop~payments");
    expect(relation.shared.map((s) => s.def)).toEqual(["Money"]);
    // And says which shapes, so the claim can be checked rather than believed.
    expect(relation.shared[0]?.blocks["shop"]?.length).toBeGreaterThan(0);
    expect(relation.shared[0]?.blocks["payments"]?.length).toBeGreaterThan(0);
    expect(names(relation)).toContain("shared-kernel");
  });

  it("holds no kernel where the two name nothing in common", () => {
    expect(find("payments~delivery").shared).toEqual([]);
  });
});

describe("patterns that are only read", () => {
  it("marks conformity and translation as read, never as counted", () => {
    for (const relation of map) {
      for (const pattern of relation.patterns) {
        const inferred =
          pattern.name === "conformist" ||
          pattern.name === "anticorruption-layer";
        expect(pattern.basis, pattern.name).toBe(inferred ? "read" : "counted");
      }
    }
  });

  it("reads conformity from the downstream naming what the upstream sends", () => {
    const relation = find("shop~delivery");
    const pattern = relation.patterns.find((p) => p.name === "conformist");
    expect(pattern?.why).toContain("Address");
  });

  it("reads a translation boundary from the downstream naming none of it", () => {
    const relation = find("payments~delivery");
    const pattern = relation.patterns.find(
      (p) => p.name === "anticorruption-layer",
    );
    expect(pattern?.upstream).toBe("payments");
    expect(pattern?.downstream).toBe("delivery");
  });

  it("reads nothing at all where there is no dependency to read it from", () => {
    for (const relation of map) {
      if (relation.dependencies.length > 0) continue;
      expect(names(relation)).not.toContain("conformist");
      expect(names(relation)).not.toContain("anticorruption-layer");
    }
  });
});
