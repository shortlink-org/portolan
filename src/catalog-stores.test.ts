// The persistence half of the contract.
//
// A store points into the domain tree in three places — the service that owns
// it, the aggregate a table persists, the block a column maps to — and a
// foreign key points at another table. Every one of those is a link that can
// dangle, and a dangling link on an ER canvas is an edge drawn into nothing.
// So each is checked here, along with the one thing the validator deliberately
// does NOT enforce: whether an outbox has a payload.

import { describe, expect, it } from "vitest";
import { rawCatalog } from "./test-catalog";
import {
  CatalogError,
  buildIndex,
  columnId,
  keyColumns,
  mapsBlockId,
  mapsFieldPath,
  validateCatalog,
} from "./catalog";
import type { Catalog, Store } from "./catalog";

const clone = (): Catalog =>
  JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog;

function failureOf(catalog: Catalog): CatalogError {
  try {
    validateCatalog(catalog);
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    return e as CatalogError;
  }
  throw new Error("expected the catalog to fail validation");
}

/** The sample's OMS database, which every case below starts from. */
function omsStore(catalog: Catalog): Store {
  const store = (catalog.stores ?? []).find((s) => s.id === "shop.oms.pg");
  if (!store) throw new Error("fixture has no shop.oms.pg store");
  return store;
}

describe("store validation", () => {
  it("accepts the sample catalog", () => {
    expect(() => validateCatalog(clone())).not.toThrow();
  });

  it("rejects a foreign key into a table nobody declared", () => {
    const bad = clone();
    const table = omsStore(bad).tables.find((t) => t.name === "order_items");
    const column = table?.columns.find((c) => c.name === "order_id");
    if (!table || !column?.fk) throw new Error("fixture has no fk column");
    column.fk.table = "shop.oms.pg.nowhere";

    const error = failureOf(bad);
    expect(error.message).toContain("shop.oms.pg.nowhere");
    expect(error.path).toBe(
      "store shop.oms.pg / table order_items / column order_id",
    );
  });

  it("rejects a foreign key into a column the target table does not have", () => {
    const bad = clone();
    const column = omsStore(bad)
      .tables.find((t) => t.name === "order_items")
      ?.columns.find((c) => c.name === "order_id");
    if (!column?.fk) throw new Error("fixture has no fk column");
    column.fk.column = "not_a_column";

    expect(failureOf(bad).message).toContain("not_a_column");
  });

  it("rejects a table that persists an aggregate the catalog has never heard of", () => {
    const bad = clone();
    const table = omsStore(bad).tables.find((t) => t.name === "orders");
    if (!table?.persists) throw new Error("fixture has no persisting table");
    table.persists.aggregate = "shop.oms.ghost";

    expect(failureOf(bad).message).toContain("shop.oms.ghost");
  });

  it("rejects a block that does not belong to the aggregate the table persists", () => {
    const bad = clone();
    const table = omsStore(bad).tables.find((t) => t.name === "order_items");
    if (!table?.persists) throw new Error("fixture has no child table");
    table.persists.block = "shop.pricing.quote.quote";

    expect(failureOf(bad).message).toContain("shop.pricing.quote.quote");
  });

  it("rejects a store owned by a service that is not in the catalog", () => {
    const bad = clone();
    omsStore(bad).owner = "shop.gone";

    // The id check fires first, and says the same thing in more detail.
    expect(failureOf(bad).message).toContain("shop.gone");
  });

  it("rejects a store whose id is not owner plus slug", () => {
    const bad = clone();
    omsStore(bad).slug = "postgres";

    const error = failureOf(bad);
    expect(error.message).toContain("shop.oms.postgres");
  });

  it("rejects an index over a column the table does not have", () => {
    const bad = clone();
    const table = omsStore(bad).tables.find((t) => t.name === "orders");
    const index = table?.indexes?.[0];
    if (!index) throw new Error("fixture has no indexes");
    index.columns = ["not_a_column"];

    expect(failureOf(bad).message).toContain("not_a_column");
  });

  it("rejects two tables with the same id", () => {
    const bad = clone();
    const store = omsStore(bad);
    const first = store.tables[0];
    if (!first) throw new Error("fixture store has no tables");
    store.tables.push({ ...first });

    expect(failureOf(bad).message).toContain(first.id);
  });

  it("rejects a service listing a store that does not exist", () => {
    const bad = clone();
    const service = bad.contexts[0]?.services[0];
    if (!service) throw new Error("fixture has no services");
    service.stores = ["nowhere.at.all"];

    expect(failureOf(bad).message).toContain("nowhere.at.all");
  });

  it("does NOT reject an outbox with no payload column", () => {
    // This is the one rule the spec calls a warning. A catalog mid-migration
    // must still render; the Problems page is where it is said out loud.
    const bad = clone();
    const outbox = omsStore(bad).tables.find((t) => t.role === "outbox");
    if (!outbox) throw new Error("fixture has no outbox");
    outbox.columns = outbox.columns.filter((c) => c.type !== "jsonb");

    expect(() => validateCatalog(bad)).not.toThrow();
  });

  it("accepts a catalog with no stores at all", () => {
    const bare = clone();
    delete bare.stores;
    for (const context of bare.contexts) {
      for (const service of context.services) delete service.stores;
    }
    expect(() => validateCatalog(bare)).not.toThrow();
  });
});

describe("view validation", () => {
  /** The sample's two OMS views, which every case below starts from. */
  function views(catalog: Catalog) {
    const found = omsStore(catalog).views;
    if (!found || found.length < 2) throw new Error("fixture has no views");
    return found;
  }

  it("rejects a view whose id does not spell out its store and name", () => {
    const bad = clone();
    (views(bad)[0] as { id: string }).id = "shop.oms.pg.something_else";
    expect(failureOf(bad).message).toContain("must have id");
  });

  it("rejects a view that collides with a table", () => {
    const bad = clone();
    const view = views(bad)[0];
    if (!view) throw new Error("fixture has no view");
    view.id = "shop.oms.pg.orders";
    view.name = "orders";
    expect(failureOf(bad).message).toContain("collides");
  });

  it("rejects a view reading something the catalog does not have", () => {
    const bad = clone();
    const view = views(bad)[0];
    if (!view) throw new Error("fixture has no view");
    view.reads = ["shop.oms.pg.nowhere"];
    const error = failureOf(bad);
    expect(error.message).toContain("shop.oms.pg.nowhere");
    expect(error.path).toBe("store shop.oms.pg / view v_open_orders");
  });

  it("rejects a key on a view, which cannot enforce one", () => {
    const bad = clone();
    const column = views(bad)[0]?.columns[0];
    if (!column) throw new Error("fixture has no view column");
    column.pk = true;
    expect(failureOf(bad).message).toContain("has no key of its own");
  });

  it("rejects a foreign key on a view", () => {
    const bad = clone();
    const column = views(bad)[0]?.columns[0];
    if (!column) throw new Error("fixture has no view column");
    column.fk = { table: "shop.oms.pg.orders", column: "id" };
    expect(failureOf(bad).message).toContain("declares a foreign key");
  });

  it("rejects lineage into a column that is not there", () => {
    const bad = clone();
    const column = views(bad)[0]?.columns[0];
    if (!column) throw new Error("fixture has no view column");
    column.from = ["shop.oms.pg.orders.no_such_column"];
    expect(failureOf(bad).message).toContain("has no column");
  });

  it("rejects lineage into a relation that is not there", () => {
    const bad = clone();
    const column = views(bad)[0]?.columns[0];
    if (!column) throw new Error("fixture has no view column");
    column.from = ["shop.oms.pg.nowhere.id"];
    expect(failureOf(bad).message).toContain("is not a table or view");
  });

  it("rejects a column derived from itself", () => {
    const bad = clone();
    const table = omsStore(bad).tables.find((t) => t.name === "outbox");
    const column = table?.columns.find((c) => c.name === "aggregate_id");
    if (!column) throw new Error("fixture has no outbox column");
    column.from = ["shop.oms.pg.outbox.aggregate_id"];
    expect(failureOf(bad).message).toContain("derived from itself");
  });

  it("accepts a store with no views at all", () => {
    const bare = clone();
    for (const store of bare.stores ?? []) delete store.views;
    expect(() => validateCatalog(bare)).not.toThrow();
  });
});

describe("store indexes", () => {
  const catalog = validateCatalog(clone());
  const index = buildIndex(catalog);

  it("resolves a table id to the store holding it", () => {
    expect(index.tableById.get("shop.oms.pg.orders")?.store.id).toBe(
      "shop.oms.pg",
    );
  });

  it("resolves a column id", () => {
    const id = columnId("shop.oms.pg.orders", "status");
    expect(index.columnById.get(id)?.column.type).toBe("text");
  });

  it("lists the stores a service owns", () => {
    expect(index.storesOwnedBy.get("shop.oms")?.map((s) => s.id)).toEqual([
      "shop.oms.pg",
    ]);
  });

  it("lists the tables that persist an aggregate", () => {
    expect(
      index.tablesByAggregate.get("shop.oms.order")?.map((t) => t.name),
    ).toEqual(["orders", "order_items"]);
  });

  it("finds a child table through the block it persists, with no aggregate named", () => {
    // The extractor is allowed to name only the block; the aggregate that owns
    // that block still has to list the table.
    const catalog2 = validateCatalog(clone());
    const store = (catalog2.stores ?? []).find((s) => s.id === "shop.oms.pg");
    const items = store?.tables.find((t) => t.name === "order_items");
    if (!items?.persists) throw new Error("fixture has no child table");
    delete items.persists.aggregate;

    const rebuilt = buildIndex(catalog2);
    expect(
      rebuilt.tablesByAggregate.get("shop.oms.order")?.map((t) => t.name),
    ).toContain("order_items");
  });

  it("indexes the columns that carry a block's fields", () => {
    const columns = index.columnsByBlock.get("shop.oms.order.order") ?? [];
    expect(columns.map((c) => c.column.name)).toContain("status");
    // A column with no `maps` is not a column that carries a field.
    expect(columns.map((c) => c.column.name)).not.toContain("placed_at");
  });

  it("resolves a view id to the store declaring it", () => {
    expect(index.viewById.get("shop.oms.pg.v_open_orders")?.store.id).toBe(
      "shop.oms.pg",
    );
  });

  it("resolves a view's column apart from a table's", () => {
    const id = columnId("shop.oms.pg.v_open_orders", "line_count");
    expect(index.viewColumnById.get(id)?.column.type).toBe("bigint");
    // The two namespaces do not leak into one another: a view column is not a
    // table column, and a caller that wants either has to ask for both.
    expect(index.columnById.has(id)).toBe(false);
  });

  it("lists the views reading a table, and a view read by another view", () => {
    expect(
      index.viewsReading.get("shop.oms.pg.orders")?.map((v) => v.name),
    ).toEqual(["v_open_orders"]);
    expect(
      index.viewsReading.get("shop.oms.pg.v_open_orders")?.map((v) => v.name),
    ).toEqual(["mv_orders_daily"]);
  });

  it("lists the views presenting an aggregate", () => {
    expect(
      index.viewsByAggregate.get("shop.oms.order")?.map((v) => v.name),
    ).toEqual(["v_open_orders"]);
  });

  it("indexes lineage from both ends", () => {
    const derived = columnId("shop.oms.pg.v_open_orders", "total_minor");
    expect(index.lineageFrom.get(derived)).toEqual([
      "shop.oms.pg.orders.total_minor",
    ]);
    expect(index.lineageInto.get("shop.oms.pg.orders.total_minor")).toEqual([
      derived,
    ]);
  });

  it("indexes lineage declared on a table, not only on a view", () => {
    expect(index.lineageFrom.get("shop.oms.pg.outbox.aggregate_id")).toEqual([
      "shop.oms.pg.orders.id",
    ]);
  });

  it("indexes what points at a table", () => {
    const into = index.fkIntoTable.get("shop.oms.pg.orders") ?? [];
    expect(into.map((o) => `${o.table.name}.${o.column.name}`)).toEqual([
      "order_items.order_id",
      "packages.order_id",
    ]);
  });
});

describe("maps paths", () => {
  const catalog = validateCatalog(clone());
  const index = buildIndex(catalog);
  const order = index.aggregateById.get("shop.oms.order");

  it("resolves the type name against the aggregate the table persists", () => {
    expect(mapsBlockId(order, "OrderLine.sku")).toBe(
      "shop.oms.order.order-line",
    );
  });

  it("resolves nothing for a type the aggregate does not declare", () => {
    expect(mapsBlockId(order, "Basket.id")).toBeNull();
    expect(mapsBlockId(undefined, "Order.id")).toBeNull();
  });

  it("keeps everything after the type name as the field path", () => {
    expect(mapsFieldPath("Order.total.amountMinor")).toBe("total.amountMinor");
    expect(mapsFieldPath("id")).toBe("id");
  });
});

describe("keyColumns", () => {
  const catalog = validateCatalog(clone());

  it("is the primary key and every foreign key, in declaration order", () => {
    const items = (catalog.stores ?? [])
      .find((s) => s.id === "shop.oms.pg")
      ?.tables.find((t) => t.name === "order_items");
    if (!items) throw new Error("fixture has no order_items");
    expect(keyColumns(items).map((c) => c.name)).toEqual([
      "order_id",
      "line_no",
    ]);
  });
});
