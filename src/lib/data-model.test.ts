// The join between a schema and a model, asserted.
//
// Most of what matters here is what does NOT get flagged. A type comparison
// that shouts about every named domain shape is worse than no comparison at
// all, so the negative cases below carry as much weight as the positive ones.

import { describe, expect, it } from "vitest";
import { rawCatalog } from "../test-catalog";
import { buildIndex, validateCatalog } from "../catalog";
import type { Catalog } from "../catalog";
import {
  columnsOfBlock,
  dbClass,
  domainClass,
  outboxOfService,
  payloadColumn,
  readersOfStore,
  storeColumnCount,
  storedFields,
  storesOfService,
  tablesPersisting,
  typesDisagree,
  unmappedFields,
} from "./data-model";

const catalog = validateCatalog(
  JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog,
);
const index = buildIndex(catalog);

/**
 * The catalog with one table's columns pointing at fields the aggregate no
 * longer declares - the shape a schema takes after a rename that never
 * reached the migrations, and the thing the drift warning is about.
 */
function drifted(): { catalog: Catalog; index: ReturnType<typeof buildIndex> } {
  const copy = JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog;
  const orders = (copy.stores ?? [])
    .find((s) => s.id === "shop.oms.pg")
    ?.tables.find((t) => t.name === "orders");
  if (!orders) throw new Error("fixture has no orders table");
  for (const column of orders.columns) if (column.maps) column.maps = `Order.${column.name}Gone`;
  const validated = validateCatalog(copy);
  return { catalog: validated, index: buildIndex(validated) };
}

describe("type classes", () => {
  it("reads postgres spellings, parameters and all", () => {
    expect(dbClass("varchar(64)")).toBe("text");
    expect(dbClass("TIMESTAMPTZ")).toBe("time");
    expect(dbClass("timestamp with time zone")).toBe("time");
    expect(dbClass("bigserial")).toBe("int64");
    expect(dbClass("jsonb")).toBe("json");
  });

  it("reads go spellings, pointers and slices and all", () => {
    expect(domainClass("*string")).toBe("text");
    expect(domainClass("[]byte")).toBe("bytes");
    expect(domainClass("time.Time")).toBe("time");
    expect(domainClass("int32")).toBe("int32");
  });

  it("knows nothing about a named domain shape, and says so", () => {
    expect(domainClass("Money")).toBe("unknown");
    expect(domainClass("GatewayRef")).toBe("unknown");
  });
});

describe("typesDisagree", () => {
  it("flags the two disagreements the spec names", () => {
    expect(typesDisagree("uuid", "string")).toBe(true);
    expect(typesDisagree("bigint", "int32")).toBe(true);
  });

  it("accepts the same shape spelled differently", () => {
    expect(typesDisagree("text", "string")).toBe(false);
    expect(typesDisagree("timestamptz", "time.Time")).toBe(false);
    expect(typesDisagree("integer", "int32")).toBe(false);
  });

  it("stays quiet when either side is a shape it does not know", () => {
    // Half the domain types in a catalog are named shapes; guessing at them
    // would bury the two real disagreements above.
    expect(typesDisagree("bigint", "Money")).toBe(false);
    expect(typesDisagree("some_extension_type", "string")).toBe(false);
  });
});

describe("storesOfService", () => {
  it("lists owned stores first, then the ones only read", () => {
    const stores = storesOfService(index, "delivery.core");
    expect(stores.map((s) => [s.store.id, s.access])).toEqual([
      ["delivery.core.pg", "owns"],
      ["shop.oms.pg", "reads"],
    ]);
  });

  it("does not call a service a reader of its own store", () => {
    const stores = storesOfService(index, "shop.oms");
    expect(stores.filter((s) => s.access === "reads")).toEqual([]);
  });

  it("finds the readers of a store from the other side", () => {
    expect(
      readersOfStore(catalog, "shop.oms.pg", "shop.oms").map((s) => s.id),
    ).toEqual(["shop.pricing", "delivery.core"]);
  });
});

describe("tablesPersisting", () => {
  it("lists every table holding an aggregate, with its store", () => {
    const tables = tablesPersisting(index, "shop.oms.order");
    expect(tables.map((t) => t.table.name)).toEqual(["orders", "order_items"]);
    expect(tables[0]?.store.id).toBe("shop.oms.pg");
  });

  it("is empty for an aggregate nothing stores", () => {
    expect(tablesPersisting(index, "shop.pricing.price-list")).toEqual([]);
  });
});

describe("outboxOfService", () => {
  it("finds the outbox in a service's own store", () => {
    expect(outboxOfService(index, "shop.oms")?.table.name).toBe("outbox");
  });

  it("is null for a service that publishes without one", () => {
    expect(outboxOfService(index, "payments.ledger")).toBeNull();
  });

  it("calls the first json column the payload", () => {
    const outbox = outboxOfService(index, "shop.oms");
    if (!outbox) throw new Error("fixture has no outbox");
    expect(payloadColumn(outbox.table)?.name).toBe("payload");
  });
});

describe("storedFields", () => {
  const stored = storedFields(catalog, index, "shop.oms.order.order");

  it("joins each column to the field it maps to", () => {
    const status = stored.find((s) => s.owner.column.name === "status");
    expect(status?.path).toBe("status");
    expect(status?.field?.type).toBe("string");
    expect(status?.mismatch).toBe(false);
  });

  it("marks the uuid column against a string field", () => {
    const id = stored.find((s) => s.owner.column.name === "id");
    expect(id?.mismatch).toBe(true);
  });

  it("leaves a named shape unmarked", () => {
    const total = stored.find((s) => s.owner.column.name === "total_minor");
    expect(total?.field?.type).toBe("Money");
    expect(total?.mismatch).toBe(false);
  });

  it("keeps a column whose field no longer exists, with no field", () => {
    const d = drifted();
    const stored = storedFields(d.catalog, d.index, "shop.oms.order.order");
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((s) => s.field === null)).toBe(true);
  });

  it("resolves a nested path against the field the block declares", () => {
    // "Order.total.amountMinor" is a fact about Money, and Money is read on
    // its own page; here it is still Order.total.
    const line = storedFields(catalog, index, "shop.oms.order.order-line");
    const price = line.find(
      (s) => s.owner.column.name === "unit_price_minor",
    );
    expect(price?.field?.name).toBe("unitPrice");
  });

  it("is empty for a block nothing stores", () => {
    expect(storedFields(catalog, index, "shop.oms.order.risk-decision")).toEqual(
      [],
    );
  });
});

describe("columnsOfBlock", () => {
  it("finds the columns pointing into a child block", () => {
    const columns = columnsOfBlock(index, "shop.oms.order.order-line");
    expect(columns.map((c) => c.column.name)).toEqual([
      "line_no",
      "sku",
      "quantity",
      "unit_price_minor",
    ]);
  });
});

describe("counts", () => {
  it("counts every column in a store", () => {
    const store = (catalog.stores ?? []).find((s) => s.id === "delivery.core.pg");
    if (!store) throw new Error("fixture has no delivery store");
    expect(storeColumnCount(store)).toBe(
      store.tables.reduce((n, t) => n + t.columns.length, 0),
    );
  });

  it("counts the fields of an aggregate no column carries", () => {
    const order = index.aggregateById.get("shop.oms.order");
    if (!order) throw new Error("fixture has no order");
    const d = drifted();
    const drift = d.index.aggregateById.get("shop.oms.order");
    if (!drift) throw new Error("drifted fixture has no order");
    // More once the columns point at names the aggregate no longer declares:
    // that gap is exactly what the drift warning counts.
    expect(unmappedFields(d.catalog, d.index, drift)).toBeGreaterThan(
      unmappedFields(catalog, index, order),
    );
  });
});
