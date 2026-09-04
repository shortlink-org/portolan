import { describe, expect, it } from "vitest";
import {
  buildIndex,
  type Aggregate,
  type Catalog,
  type Channel,
  type ChannelMessage,
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

/** `send cart.BasketCreated` reads as the direction and the name it goes by. */
function channel(address: string, ...messages: string[]): Channel {
  return {
    address,
    source: "asyncapi.yaml",
    messages: messages.map((spelled): ChannelMessage => {
      const [direction, name] = spelled.split(" ");

      return { name: name ?? "", direction: direction === "send" ? "send" : "receive" };
    }),
  };
}

function speaking(service: Service, ...channels: Channel[]): Service {
  return { ...service, channels };
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

  // A document that promises a send is the same collision one release earlier,
  // so it counts as publishing even before an event of that service does.
  it("counts a declared send as publishing", () => {
    const oms = speaking(
      service("shop.oms", []),
      channel("shop.cart.basket", "send oms.OrderPlaced"),
    );
    const problems = found(catalogWith([cart(), oms]));

    expect(problems.filter((p) => p.kind === "shared-channel")).toHaveLength(2);
    const theirs = problems.find((p) => p.service === "shop.oms");
    // No event of theirs to point at, so the row leads to the service.
    expect(theirs?.id).toBe("shop.oms");
    expect(theirs?.source).toBe("asyncapi.yaml");
    const ours = problems.find((p) => p.service === "shop.cart");
    expect(ours?.note).toContain("oms.OrderPlaced");
  });

  it("reports an event going out where the document does not say", () => {
    const one = speaking(
      cart(),
      channel("shop.cart.wishlist", "send cart.ItemWished"),
    );
    const problems = found(catalogWith([one]));

    const undeclared = problems.filter((p) => p.kind === "channel-undeclared");
    expect(undeclared.map((p) => [p.id, p.peer])).toEqual([
      ["shop.cart.basket.BasketCreated", "shop.cart.basket"],
      ["shop.cart.basket.BasketCheckedOut", "shop.cart.basket"],
    ]);
    expect(undeclared[0]?.severity).toBe("warning");
  });

  it("reports a declared channel no event names", () => {
    const one = speaking(
      cart(),
      channel("shop.cart.basket", "send cart.BasketCreated"),
      channel("shop.cart.wishlist", "send cart.ItemWished"),
    );
    const problems = found(catalogWith([one]));

    const promised = problems.filter((p) => p.kind === "channel-unpublished");
    expect(promised.map((p) => p.peer)).toEqual(["shop.cart.wishlist"]);
    expect(promised[0]?.id).toBe("shop.cart");
    expect(promised[0]?.note).toContain("cart.ItemWished");
  });

  // Silence is not a disagreement: a service with no document is a service
  // nobody has written one for, not one that publishes where it should not.
  it("says nothing about a service with no document", () => {
    expect(found(catalogWith([cart()]))).toEqual([]);
  });

  // The one edge in the catalog that runs from the subscriber outwards.
  it("resolves a subscription against whoever publishes the name", () => {
    const oms = speaking(
      service("shop.oms", []),
      channel("shop.cart.basket", "receive BasketCreated"),
    );
    const problems = found(catalogWith([cart(), oms]));

    expect(problems.filter((p) => p.kind === "subscription-unresolved")).toEqual(
      [],
    );
  });

  it("reports a subscription nothing in the estate publishes", () => {
    const oms = speaking(
      service("shop.oms", []),
      channel("billing_invoice", "receive billing.InvoiceRaised"),
    );
    const problems = found(catalogWith([cart(), oms]));

    const unresolved = problems.filter(
      (p) => p.kind === "subscription-unresolved",
    );
    expect(unresolved.map((p) => [p.service, p.peer])).toEqual([
      ["shop.oms", "billing.InvoiceRaised"],
    ]);
    expect(unresolved[0]?.severity).toBe("warning");
  });
});
