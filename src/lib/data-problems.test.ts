// The four persistence problems, each proved to fire and — more importantly —
// each proved not to fire on the cases that look like it.

import { describe, expect, it } from "vitest";
import { rawCatalog } from "../test-catalog";
import { buildIndex, validateCatalog } from "../catalog";
import type { Catalog } from "../catalog";
import type { Problem } from "./derive";
import { dataProblems } from "./data-problems";

const clone = (): Catalog =>
  JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog;

function found(catalog: Catalog) {
  return dataProblems(catalog, buildIndex(validateCatalog(catalog)));
}

const kinds = (list: { kind: string }[]) => list.map((p) => p.kind);

describe("the sample estate", () => {
  const problems = found(clone());

  it("reports the intentional cross-service foreign key", () => {
    const fk = problems.find((p) => p.kind === "cross-service-fk");
    expect(fk?.id).toBe("delivery.core.pg.packages.order_id");
    expect(fk?.peer).toBe("shop.oms.pg.orders");
    expect(fk?.severity).toBe("error");
  });

  it("reports the table one service writes in another's database", () => {
    const shared = problems.find((p) => p.kind === "shared-store");
    expect(shared?.id).toBe("shop.oms.pg.price_snapshots");
    expect(shared?.peer).toBe("shop.pricing");
    expect(shared?.severity).toBe("error");
  });

  it("reports no persistence drift: every table's columns follow its aggregate", () => {
    expect(problems.filter((p) => p.kind === "persistence-drift")).toEqual([]);
  });

  it("reports a renamed table whose columns did not follow", () => {
    const drifted = clone();
    const orders = (drifted.stores ?? [])
      .find((s) => s.id === "shop.oms.pg")
      ?.tables.find((t) => t.name === "orders");
    if (!orders) throw new Error("fixture has no orders table");
    for (const column of orders.columns) if (column.maps) column.maps = `Order.${column.name}Gone`;
    const drift = found(drifted).find((p) => p.kind === "persistence-drift");
    expect(drift?.id).toBe("shop.oms.pg.orders");
    expect(drift?.severity).toBe("warning");
  });

  it("reports every type disagreement and nothing else", () => {
    const types = problems.filter((p) => p.kind === "column-type");
    expect(types.map((p) => p.id)).toEqual([
      "shop.oms.pg.orders.id",
      "shop.oms.pg.order_items.quantity",
      "delivery.core.pg.packages.order_id",
      "auth.auth.pg.lockouts.failures",
      "shop.cart.pg.baskets.id",
      "shop.cart.pg.basket_items.basket_id",
    ]);
  });

  it("reports the value delivery copies out of the OMS schema", () => {
    const copied = problems.filter((p) => p.kind === "cross-service-lineage");
    expect(copied.map((p) => p.id)).toEqual([
      "delivery.core.pg.packages.ship_to",
    ]);
    expect(copied[0]?.peer).toBe("shop.oms.pg.orders.ship_to");
    // A warning, not an error: copying is how a service stays out of someone
    // else's database, and the alternative — a foreign key — is the error
    // right above it.
    expect(copied[0]?.severity).toBe("warning");
  });

  it("says nothing about lineage that stays inside one service", () => {
    const inside = problems.filter(
      (p) =>
        p.kind === "cross-service-lineage" &&
        p.id.startsWith("shop.oms.pg.outbox"),
    );
    expect(inside).toEqual([]);
  });

  it("says nothing about the outbox, which has its payload", () => {
    expect(kinds(problems)).not.toContain("outbox-payload");
  });

  it("puts every error before every warning", () => {
    const at = problems.findIndex((p) => p.severity === "warning");
    expect(problems.slice(0, at).every((p) => p.severity === "error")).toBe(
      true,
    );
    expect(problems.slice(at).every((p) => p.severity === "warning")).toBe(
      true,
    );
  });
});

describe("cases that only look like problems", () => {
  it("does not call a foreign key inside one store a boundary leak", () => {
    const problems = found(clone());
    const inside = problems.filter(
      (p) =>
        p.kind === "cross-service-fk" &&
        p.id.startsWith("shop.oms.pg.order_items"),
    );
    expect(inside).toEqual([]);
  });

  it("does not call a projection of someone else's aggregate a shared database", () => {
    // A local read model built from another service's events is the pattern
    // this rule has to leave alone.
    const catalog = clone();
    const store = (catalog.stores ?? []).find((s) => s.id === "delivery.core.pg");
    const stops = store?.tables.find((t) => t.name === "route_stops");
    if (!stops) throw new Error("fixture has no projection");
    stops.persists = { aggregate: "shop.oms.order" };

    const shared = found(catalog).filter(
      (p) => p.kind === "shared-store" && p.id === stops.id,
    );
    expect(shared).toEqual([]);
  });

  it("does not accuse a derived table of drifting from an aggregate", () => {
    const problems = found(clone());
    const derived = problems.filter(
      (p) =>
        p.kind === "persistence-drift" &&
        p.id === "delivery.core.pg.route_stops",
    );
    expect(derived).toEqual([]);
  });

  it("does not report drift for a table whose columns still map", () => {
    const problems = found(clone());
    expect(
      problems.filter(
        (p) => p.kind === "persistence-drift" && p.id === "shop.oms.pg.orders",
      ),
    ).toEqual([]);
  });
});

describe("an outbox with nothing in it", () => {
  it("is a warning, and names the store", () => {
    const catalog = clone();
    const outbox = (catalog.stores ?? [])
      .find((s) => s.id === "shop.oms.pg")
      ?.tables.find((t) => t.role === "outbox");
    if (!outbox) throw new Error("fixture has no outbox");
    outbox.columns = outbox.columns.filter((c) => c.type !== "jsonb");

    const problem = found(catalog).find((p) => p.kind === "outbox-payload");
    expect(problem?.severity).toBe("warning");
    expect(problem?.id).toBe("shop.oms.pg.outbox");
    expect(problem?.peer).toBe("shop.oms.pg");
  });
});

describe("a catalog with no stores", () => {
  it("has no persistence problems at all", () => {
    const bare = clone();
    delete bare.stores;
    for (const context of bare.contexts) {
      for (const service of context.services) delete service.stores;
    }
    expect(found(bare)).toEqual([]);
  });
});

// A compile-time check that the shared shape really is shared: the page renders
// one row component over both lists, so the two must stay one type.
const _shape: (p: Problem) => string = (p) => `${p.severity}:${p.kind}`;
void _shape;
