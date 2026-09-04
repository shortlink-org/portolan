// What the canvas decides before it draws anything.

import { describe, expect, it } from "vitest";
import { rawCatalog } from "../test-catalog";
import { buildIndex, validateCatalog } from "../catalog";
import type { Catalog, Store, Table, View } from "../catalog";
import { pathologicalCatalog } from "../lib/scenarios";
import {
  MAX_ROWS,
  erSpec,
  matchingNodes,
  nodeHeight,
  outboundKeys,
  outboundLineage,
  visibleColumns,
} from "./spec";

const catalog = validateCatalog(
  JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog,
);
const index = buildIndex(catalog);

function store(id: string): Store {
  const found = (catalog.stores ?? []).find((s) => s.id === id);
  if (!found) throw new Error(`fixture has no store ${id}`);
  return found;
}

function table(storeId: string, name: string): Table {
  const found = store(storeId).tables.find((t) => t.name === name);
  if (!found) throw new Error(`fixture has no table ${name}`);
  return found;
}

function view(storeId: string, name: string): View {
  const found = (store(storeId).views ?? []).find((v) => v.name === name);
  if (!found) throw new Error(`fixture has no view ${name}`);
  return found;
}

describe("visibleColumns", () => {
  const orders = table("shop.oms.pg", "orders");
  const items = table("shop.oms.pg", "order_items");

  it("collapses to the key columns", () => {
    expect(visibleColumns(items, { mode: "keys" }).map((c) => c.name)).toEqual([
      "order_id",
      "line_no",
    ]);
  });

  it("shows everything in all mode", () => {
    expect(visibleColumns(orders, { mode: "all" })).toHaveLength(
      orders.columns.length,
    );
  });

  it("shows everything for a table the reader opened by hand", () => {
    const expanded = new Set([orders.id]);
    expect(visibleColumns(orders, { mode: "keys", expanded })).toHaveLength(
      orders.columns.length,
    );
  });

  it("falls back to the first rows for a table with no keys at all", () => {
    // An empty card would say "this table has nothing in it", which is a
    // different claim from "nothing in it is a key".
    const keyless: Table = {
      id: "x.y.z",
      name: "z",
      columns: [
        { name: "a", type: "text", nullable: false },
        { name: "b", type: "text", nullable: false },
        { name: "c", type: "text", nullable: false },
        { name: "d", type: "text", nullable: false },
      ],
    };
    expect(visibleColumns(keyless, { mode: "keys" }).map((c) => c.name)).toEqual(
      ["a", "b", "c"],
    );
  });
});

describe("nodeHeight", () => {
  it("stops growing past the row cap", () => {
    expect(nodeHeight(MAX_ROWS + 30, 0)).toBe(nodeHeight(MAX_ROWS, 0));
  });

  it("makes room for the overflow footer only when there is one", () => {
    expect(nodeHeight(3, 1)).toBeGreaterThan(nodeHeight(3, 0));
  });
});

describe("erSpec", () => {
  const spec = erSpec(index, store("shop.oms.pg"), { mode: "keys" });

  it("makes one node per table, in catalog order", () => {
    expect(spec.nodes.filter((n) => n.kind === "table").map((n) => n.name))
      .toEqual([
        "orders",
        "order_items",
        "outbox",
        "price_snapshots",
      ]);
  });

  it("counts what a collapsed card is not showing", () => {
    const orders = spec.nodes.find((n) => n.name === "orders");
    expect(orders?.hidden).toBe(
      table("shop.oms.pg", "orders").columns.length - 1,
    );
  });

  it("tints a table by the context that owns the aggregate it holds", () => {
    const orders = spec.nodes.find((n) => n.name === "orders");
    expect(orders?.context).toBe("shop");
    // The one table another service writes is tinted by THAT service's
    // context, which is the whole tell.
    const snapshots = spec.nodes.find((n) => n.name === "price_snapshots");
    expect(snapshots?.aggregate).toBe("shop.pricing.quote");
  });

  it("draws an edge for a key inside the store", () => {
    const edge = spec.edges.find((e) => e.from === "shop.oms.pg.order_items");
    expect(edge?.to).toBe("shop.oms.pg.orders");
    expect(edge?.fromColumn).toBe("order_id");
    expect(edge?.toColumn).toBe("id");
    expect(edge?.onDelete).toBe("cascade");
  });

  it("draws no edge for a key that leaves the store", () => {
    // delivery's packages point into this store; nothing on this canvas can
    // stand for the far end, so no edge is invented for it.
    const into = spec.edges.filter((e) => !e.from.startsWith("shop.oms.pg"));
    expect(into).toEqual([]);
  });

  it("makes a card for every view, after the tables", () => {
    expect(spec.nodes.filter((n) => n.kind === "view").map((n) => n.name)).toEqual(
      ["v_open_orders", "mv_orders_daily"],
    );
    const daily = spec.nodes.find((n) => n.name === "mv_orders_daily");
    expect(daily?.badge).toBe("matview");
    expect(daily?.view?.materialized).toBe(true);
  });

  it("leaves the views out when the reader switches them off", () => {
    const tablesOnly = erSpec(index, store("shop.oms.pg"), {
      mode: "keys",
      views: false,
    });
    expect(tablesOnly.nodes.every((n) => n.kind === "table")).toBe(true);
    // And with them, the lineage that ran through them: an edge with one end
    // missing is a line into nowhere.
    expect(tablesOnly.edges.some((e) => e.to.includes("v_open_orders"))).toBe(
      false,
    );
  });

  it("draws lineage from the source column to the derived one", () => {
    const edge = spec.edges.find(
      (e) => e.id === "shop.oms.pg.orders.id~>shop.oms.pg.outbox.aggregate_id",
    );
    expect(edge?.kind).toBe("lineage");
    expect(edge?.from).toBe("shop.oms.pg.orders");
    expect(edge?.to).toBe("shop.oms.pg.outbox");
  });

  it("chains one view into the next", () => {
    const chained = spec.edges.filter(
      (e) =>
        e.from === "shop.oms.pg.v_open_orders" &&
        e.to === "shop.oms.pg.mv_orders_daily",
    );
    expect(chained).toHaveLength(3);
    expect(chained.every((e) => e.kind === "lineage")).toBe(true);
  });

  it("drops lineage entirely when the reader switches it off", () => {
    const keysOnly = erSpec(index, store("shop.oms.pg"), {
      mode: "keys",
      lineage: false,
    });
    expect(keysOnly.edges.every((e) => e.kind === "fk")).toBe(true);
    // The views themselves stay: a card with no lines is still a schema fact.
    expect(keysOnly.nodes.some((n) => n.kind === "view")).toBe(true);
  });

  it("joins card to card when a view says only what it reads", () => {
    const delivery = erSpec(index, store("delivery.core.pg"), { mode: "keys" });
    const coarse = delivery.edges.filter(
      (e) => e.to === "delivery.core.pg.mv_route_load",
    );
    expect(coarse.map((e) => e.from)).toEqual([
      "delivery.core.pg.route_stops",
      "delivery.core.pg.parcels",
    ]);
    expect(coarse.every((e) => e.fromColumn === null && e.toColumn === null)).toBe(
      true,
    );
  });

  it("shows a view's derived columns on a collapsed card", () => {
    const open = spec.nodes.find((n) => n.name === "v_open_orders");
    // Every column of this view is computed from somewhere, so a collapsed
    // card is the whole view rather than the first three rows.
    expect(open?.rows).toHaveLength(view("shop.oms.pg", "v_open_orders").columns.length);
    expect(open?.hidden).toBe(0);
  });

  it("leaves the database's default off the label", () => {
    const delivery = erSpec(index, store("delivery.core.pg"), { mode: "keys" });
    const restricted = delivery.edges.find(
      (e) => e.kind === "fk" && e.from === "delivery.core.pg.packages",
    );
    expect(restricted).toBeUndefined();
    const cascade = delivery.edges.find(
      (e) => e.from === "delivery.core.pg.parcels",
    );
    expect(cascade?.onDelete).toBe("cascade");
  });

  it("marks every node ghosted when the store is only read", () => {
    const ghosted = erSpec(index, store("shop.oms.pg"), {
      mode: "keys",
      ghost: true,
    });
    expect(ghosted.nodes.every((n) => n.ghost)).toBe(true);
  });
});

describe("outboundKeys", () => {
  it("lists the keys that leave a store, with the service on the far end", () => {
    const out = outboundKeys(index, store("delivery.core.pg"));
    expect(out).toEqual([
      {
        from: "delivery.core.pg.packages",
        fromColumn: "order_id",
        to: "shop.oms.pg.orders",
        peer: "shop.oms",
      },
    ]);
  });

  it("is empty for a self-contained schema", () => {
    expect(outboundKeys(index, store("payments.ledger.pg"))).toEqual([]);
  });
});

describe("outboundLineage", () => {
  it("lists the values copied in from another service's schema", () => {
    expect(outboundLineage(index, store("delivery.core.pg"))).toEqual([
      {
        from: "delivery.core.pg.packages",
        fromColumn: "ship_to",
        to: "shop.oms.pg.orders.ship_to",
        peer: "shop.oms",
      },
    ]);
  });

  it("says nothing about lineage that stays inside the store", () => {
    expect(outboundLineage(index, store("shop.oms.pg"))).toEqual([]);
  });
});

describe("matchingNodes", () => {
  const spec = erSpec(index, store("shop.oms.pg"), { mode: "keys" });

  it("matches a table by name", () => {
    expect([...matchingNodes(spec, "outbox")]).toEqual(["shop.oms.pg.outbox"]);
  });

  it("matches a table by a column it holds, even a hidden one", () => {
    expect([...matchingNodes(spec, "published_at")]).toEqual([
      "shop.oms.pg.outbox",
    ]);
  });

  it("matches a view by its SQL", () => {
    expect([...matchingNodes(spec, "LEFT JOIN order_items")]).toEqual([
      "shop.oms.pg.v_open_orders",
    ]);
  });

  it("matches by the aggregate a relation persists", () => {
    expect([...matchingNodes(spec, "shop.oms.order")]).toEqual([
      "shop.oms.pg.orders",
      "shop.oms.pg.order_items",
      "shop.oms.pg.v_open_orders",
    ]);
  });

  it("matches nothing on an empty term", () => {
    expect(matchingNodes(spec, "  ").size).toBe(0);
  });
});

describe("the pathological store", () => {
  const bad = pathologicalCatalog();
  const badIndex = buildIndex(validateCatalog(bad));
  const badStore = (bad.stores ?? [])[0];
  if (!badStore) throw new Error("scenario has no store");
  const spec = erSpec(badIndex, badStore, { mode: "keys" });

  it("caps the height of a 45-column table once every column is asked for", () => {
    const all = erSpec(badIndex, badStore, { mode: "all" });
    const wide = all.nodes.find((n) => n.name === "wide");
    if (!wide) throw new Error("scenario has no wide table");
    expect(wide.columns).toHaveLength(45);
    expect(wide.rows).toHaveLength(45);
    expect(wide.scrolls).toBe(true);
    expect(wide.height).toBe(nodeHeight(MAX_ROWS, 0));
  });

  it("collapses that same table to its one key column", () => {
    const wide = spec.nodes.find((n) => n.name === "wide");
    expect(wide?.rows.map((c) => c.name)).toEqual(["id"]);
    expect(wide?.hidden).toBe(44);
    expect(wide?.scrolls).toBe(false);
  });

  it("keeps a self-referencing key as an edge from a table to itself", () => {
    const loop = spec.edges.find((e) => e.from === e.to);
    expect(loop?.from).toBe("edge.core.pg.tree");
  });

  it("shows both halves of a composite key on a collapsed card", () => {
    const composite = spec.nodes.find((n) => n.name === "composite");
    expect(composite?.rows.map((c) => c.name)).toEqual([
      "tenant_id",
      "thing_id",
    ]);
  });

  it("draws both directions of a two-table cycle", () => {
    const cycle = spec.edges.filter(
      (e) =>
        (e.from === "edge.core.pg.a" && e.to === "edge.core.pg.b") ||
        (e.from === "edge.core.pg.b" && e.to === "edge.core.pg.a"),
    );
    expect(cycle).toHaveLength(2);
  });
});
