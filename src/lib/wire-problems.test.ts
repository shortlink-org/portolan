import { describe, expect, it } from "vitest";
import {
  buildIndex,
  type Aggregate,
  type Catalog,
  type Event,
  type Service,
} from "../catalog";
import { catalog as estate } from "../data";
import { wireProblems } from "./wire-problems";

function event(id: string, channel?: string): Event {
  const name = id.slice(id.lastIndexOf(".") + 1);
  return {
    id,
    slug: name.toLowerCase(),
    name,
    versions: [{ version: "v1", doc: "", source: `${name}.ts`, fields: [] }],
    consumers: [],
    ...(channel ? { wire: { name, channel } } : {}),
  };
}

function aggregate(id: string, events: Event[]): Aggregate {
  const name = id.slice(id.lastIndexOf(".") + 1);
  return {
    id,
    slug: name,
    name,
    readme: "",
    root: name,
    entities: [],
    valueObjects: [],
    operations: [],
    events,
  };
}

function service(id: string, aggregates: Aggregate[]): Service {
  const slug = id.slice(id.indexOf(".") + 1);
  return {
    id,
    slug,
    name: slug,
    repo: "",
    path: "",
    readme: "",
    provides: [],
    consumes: [],
    aggregates,
  };
}

function catalogWith(services: Service[]): Catalog {
  return {
    generatedAt: "2024-01-01T00:00:00Z",
    commit: "abc1234",
    contexts: [
      { id: "shop", slug: "shop", name: "Shop", summary: "", services },
    ],
    defs: {},
    flows: [],
    adrs: [],
  };
}

function found(catalog: Catalog) {
  return wireProblems(catalog, buildIndex(catalog));
}

const cart = () =>
  service("shop.cart", [
    aggregate("shop.cart.basket", [
      event("shop.cart.basket.BasketCreated", "shop.cart.basket"),
      event("shop.cart.basket.BasketCheckedOut", "shop.cart.basket"),
    ]),
  ]);

describe("wireProblems", () => {
  it("reports each side of a channel two services publish on", () => {
    const oms = service("shop.oms", [
      aggregate("shop.oms.order", [
        event("shop.oms.order.OrderPlaced", "shop.cart.basket"),
      ]),
    ]);
    const problems = found(catalogWith([cart(), oms]));

    expect(problems.map((p) => [p.service, p.id, p.peer])).toEqual([
      ["shop.cart", "shop.cart.basket.BasketCreated", "shop.oms"],
      ["shop.oms", "shop.oms.order.OrderPlaced", "shop.cart"],
    ]);
    const [first] = problems;
    expect(first?.kind).toBe("shared-channel");
    expect(first?.severity).toBe("error");
    expect(first?.note).toContain("OrderPlaced");
    expect(first?.source).toBe("BasketCreated.ts");
  });

  it("lets one service put several aggregates on one channel", () => {
    const one = service("shop.cart", [
      aggregate("shop.cart.basket", [
        event("shop.cart.basket.BasketCreated", "shop.cart"),
      ]),
      aggregate("shop.cart.wishlist", [
        event("shop.cart.wishlist.ItemWished", "shop.cart"),
      ]),
    ]);
    expect(found(catalogWith([one]))).toEqual([]);
  });

  it("says nothing about channels nobody shares, or events with no wire", () => {
    const oms = service("shop.oms", [
      aggregate("shop.oms.order", [
        event("shop.oms.order.OrderPlaced", "shop.oms.order"),
        event("shop.oms.order.OrderCancelled"),
      ]),
    ]);
    expect(found(catalogWith([cart(), oms]))).toEqual([]);
  });

  it("finds nothing in the estate as it stands", () => {
    expect(found(estate)).toEqual([]);
  });
});
