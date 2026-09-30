import { describe, expect, it } from "vitest";
import type { Catalog, Store, TableAccess } from "../catalog";
import { catalog as estate } from "../testing/estate";
import {
  creditAccess,
  crossStoreRefs,
  repositoryCellKey,
  storeAccessMatrix,
} from "./store-access";

// The estate's stores carry no accesses, so each case lays its own over the
// estate's shop.oms.pg and, where attribution is the question, gives the
// services the directories a monorepo would.

const oms = (estate.stores ?? []).find((store) => store.id === "shop.oms.pg")!;

function withAccesses(accesses: Record<string, TableAccess[]>): Store {
  return {
    ...oms,
    tables: oms.tables.map((table) =>
      accesses[table.name] ? { ...table, accesses: accesses[table.name] } : table,
    ),
  };
}

function withPaths(paths: Record<string, string>): Catalog {
  const repo = estate.contexts
    .flatMap((context) => context.services)
    .find((service) => service.id === "shop.oms")!.repo;
  return {
    ...estate,
    contexts: estate.contexts.map((context) => ({
      ...context,
      services: context.services.map((service) =>
        paths[service.id] !== undefined
          ? { ...service, repo, path: paths[service.id]! }
          : service,
      ),
    })),
  };
}

describe("storeAccessMatrix", () => {
  it("credits every call to the owner when no other service claims its directory", () => {
    const store = withAccesses({
      orders: [
        { operation: "read", method: "Postgres.ByID", source: "internal/order/repository/postgres.go:40" },
        { operation: "write", method: "Postgres.Save", source: "internal/order/repository/postgres.go:20" },
      ],
      outbox: [
        { operation: "write", method: "Postgres.Save", source: "internal/order/repository/postgres.go:30" },
      ],
    });
    const matrix = storeAccessMatrix(store, estate);

    expect(matrix.services.map((service) => [service.id, service.owner, service.count])).toEqual([
      ["shop.oms", true, 3],
    ]);
    expect(matrix.accessCount).toBe(3);
    // Touched tables by name, then the tables no call was recorded for.
    expect(matrix.rows.map((row) => row.table.name)).toEqual([
      "orders",
      "outbox",
      "order_items",
      "price_snapshots",
    ]);
    const orders = matrix.rows[0]!;
    expect(orders.cells.get("shop.oms")?.operations).toEqual(["read", "write"]);
    expect(orders.shared).toBe(false);
    expect(orders.sharedWrite).toBe(false);
    // Listed as readers of the store, but with nothing recorded against a table.
    expect(matrix.declaredReaders).toEqual(["delivery.core", "shop.pricing"]);
  });

  it("puts tables written by two services first and flags them", () => {
    const catalog = withPaths({ "shop.oms": "services/oms", "shop.pricing": "services/pricing" });
    const store = withAccesses({
      order_items: [
        { operation: "write", method: "Postgres.Save", source: "services/oms/repository/postgres.go:12" },
        { operation: "read", method: "Snapshot.Lines", source: "services/pricing/snapshot/read.go:8" },
      ],
      orders: [
        { operation: "write", method: "Postgres.Save", source: "services/oms/repository/postgres.go:10" },
        { operation: "delete", method: "Cleanup.Expired", source: "services/pricing/cleanup/job.go:5" },
      ],
      outbox: [
        { operation: "write", method: "Postgres.Save", source: "services/oms/repository/postgres.go:14" },
      ],
    });
    const matrix = storeAccessMatrix(store, catalog);

    expect(matrix.services.map((service) => service.id)).toEqual(["shop.oms", "shop.pricing"]);
    const [orders, items] = matrix.rows;
    expect(orders!.table.name).toBe("orders");
    expect(orders!.sharedWrite).toBe(true);
    expect(orders!.writers).toEqual(["shop.oms", "shop.pricing"]);
    expect(orders!.cells.get("shop.pricing")?.operations).toEqual(["delete"]);
    expect(items!.table.name).toBe("order_items");
    expect(items!.shared).toBe(true);
    expect(items!.sharedWrite).toBe(false);
    expect(items!.writers).toEqual(["shop.oms"]);
    // shop.pricing has a column now, so it is no longer only declared.
    expect(matrix.declaredReaders).toEqual(["delivery.core"]);
  });

  it("opens a service into repositories, telling two Repository types apart by directory", () => {
    const store = withAccesses({
      orders: [
        { operation: "write", method: "Repository.Save", source: "internal/order/repository.go:10" },
        { operation: "read", method: "Repository.ByID", source: "internal/order/repository.go:20" },
      ],
      price_snapshots: [
        { operation: "read", method: "Repository.Current", source: "internal/price/repository.go:5" },
        { operation: "write", method: "Postgres.Save" },
      ],
    });
    const matrix = storeAccessMatrix(store, estate);
    const [service] = matrix.services;

    expect(service!.repositories.map((repository) => repository.label)).toEqual([
      "order/Repository",
      "Postgres",
      "price/Repository",
    ]);
    const orderRepository = service!.repositories.find((r) => r.label === "order/Repository")!;
    const orders = matrix.rows.find((row) => row.table.name === "orders")!;
    expect(
      orders.cells.get(repositoryCellKey("shop.oms", orderRepository.key))?.accesses,
    ).toHaveLength(2);
  });
});

describe("creditAccess", () => {
  const catalog = withPaths({ "shop.oms": "services/oms", "shop.pricing": "services/oms/pricing" });
  const services = catalog.contexts.flatMap((context) => context.services);
  const owner = services.find((service) => service.id === "shop.oms");

  it("prefers the deepest directory that holds the file", () => {
    expect(
      creditAccess({ operation: "read", source: "services/oms/pricing/read.go:3" }, owner, services),
    ).toBe("shop.pricing");
    expect(
      creditAccess({ operation: "read", source: "services/oms/repo.go:3" }, owner, services),
    ).toBe("shop.oms");
  });

  it("keeps a call with no source, or outside every directory, with the owner", () => {
    expect(creditAccess({ operation: "write" }, owner, services)).toBe("shop.oms");
    expect(creditAccess({ operation: "write", source: "cmd/main.go:1" }, owner, services)).toBe(
      "shop.oms",
    );
  });
});

describe("crossStoreRefs", () => {
  it("lists another store's copies and keys that point into this one", () => {
    const refs = crossStoreRefs(oms, estate);
    expect(refs.map((ref) => [ref.direction, ref.kind, ref.column, ref.target, ref.columnStore])).toEqual([
      ["in", "copy", "delivery.core.pg.packages.ship_to", "shop.oms.pg.orders.ship_to", "delivery.core.pg"],
      ["in", "fk", "delivery.core.pg.packages.order_id", "shop.oms.pg.orders.id", "delivery.core.pg"],
    ]);
  });

  it("lists this store's columns that point out, and leaves lineage inside the store alone", () => {
    const delivery = (estate.stores ?? []).find((store) => store.id === "delivery.core.pg")!;
    const refs = crossStoreRefs(delivery, estate);
    expect(refs.map((ref) => [ref.direction, ref.kind, ref.column, ref.targetStore])).toEqual([
      ["out", "copy", "delivery.core.pg.packages.ship_to", "shop.oms.pg"],
      ["out", "fk", "delivery.core.pg.packages.order_id", "shop.oms.pg"],
    ]);
  });
});
