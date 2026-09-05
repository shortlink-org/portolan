// The schema over the transport, with the peers stood in for.
//
// What is worth pinning here is not that a resolver returns what a port was
// told to return - it is the translation on the way out and the two things
// the transport does: the bearer reaching the context, and a peer that did
// not answer arriving as something a client can act on rather than as
// "unexpected error".
import { describe, expect, it } from "vitest";
import type { Ports } from "../../../di/container.ts";
import { PeerError } from "../../errors.ts";
import type { Basket, Baskets, Checkout, Line } from "../../../ports/baskets.ts";
import type { OrderEvents, OrderMoved } from "../../../ports/order-events.ts";
import type { Order, Orders } from "../../../ports/orders.ts";
import type { Session, Sessions } from "../../../ports/sessions.ts";
import type { Shipment, Shipments } from "../../../ports/shipments.ts";
import { buildServer } from "./server.ts";

const money = { amountMinor: 1250, currency: "GBP" };

class OneSession implements Sessions {
  constructor(private readonly bearer: string) {}
  async current(bearer: string): Promise<Session | null> {
    return bearer === this.bearer ? { userId: "u-1", expiresAt: "2026-01-01T00:00:00Z" } : null;
  }
}

class OneBasket implements Baskets {
  seen: string[] = [];
  async byId(bearer: string, basketId: string): Promise<Basket | null> {
    this.seen.push(bearer);

    return basketId === "b-1" ? { id: "b-1", status: "OPEN", lines: [{ sku: "SKU-1", quantity: 2, unitPrice: money }], subtotal: money } : null;
  }
  async addItem(_bearer: string, basketId: string, line: Line): Promise<Basket> {
    return { id: basketId, status: "OPEN", lines: [line], subtotal: line.unitPrice };
  }
  async removeItem(_bearer: string, basketId: string): Promise<Basket> {
    return { id: basketId, status: "OPEN", lines: [], subtotal: null };
  }
  async checkout(_bearer: string, basketId: string): Promise<Checkout> {
    return { basketId, quoteId: "q-1", total: money };
  }
}

class NoOrders implements Orders {
  async byId(): Promise<Order | null> {
    return null;
  }
  async cancel(): Promise<Order> {
    throw new PeerError("oms", "did not answer");
  }
}

class NoShipments implements Shipments {
  async byId(): Promise<Shipment | null> {
    return null;
  }
}

class NoMoves implements OrderEvents {
  async *moves(): AsyncIterable<OrderMoved> {}
}

function ports(over: Partial<Ports> = {}): Ports {
  return {
    sessions: new OneSession("live"),
    baskets: new OneBasket(),
    orders: new NoOrders(),
    shipments: new NoShipments(),
    orderEvents: new NoMoves(),
    ...over,
  };
}

async function ask(query: string, over: Partial<Ports> = {}, bearer?: string): Promise<{ data: Record<string, unknown> | null; errors?: { message: string; extensions?: Record<string, unknown> }[] }> {
  const yoga = buildServer(ports(over));
  const response = await yoga.fetch("http://bff/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ query }),
  });

  return response.json();
}

describe("the storefront schema", () => {
  it("answers with the viewer when the request carries a live session", async () => {
    const { data } = await ask("{ viewer { userId } }", {}, "live");

    expect(data?.viewer).toEqual({ userId: "u-1" });
  });

  // Not an error: a storefront is browsed by people who have not signed in.
  it("answers with no viewer when the request carries nothing", async () => {
    const { data } = await ask("{ viewer { userId } }");

    expect(data?.viewer).toBeNull();
  });

  // The bearer is the transport's business, and every port is given it.
  it("passes the bearer on to the peers", async () => {
    const baskets = new OneBasket();
    await ask('{ basket(id: "b-1") { id } }', { baskets }, "live");

    expect(baskets.seen).toEqual(["live"]);
  });

  // The cart says `basketId`, `items` and `checked-out`; the client is told
  // `id`, `lines` and `OPEN`, and never has to know both.
  it("answers in the storefront's own words", async () => {
    const { data } = await ask('{ basket(id: "b-1") { id status lines { sku quantity unitPrice { amountMinor currency } } subtotal { amountMinor } } }', {}, "live");

    expect(data?.basket).toEqual({
      id: "b-1",
      status: "OPEN",
      lines: [{ sku: "SKU-1", quantity: 2, unitPrice: { amountMinor: 1250, currency: "GBP" } }],
      subtotal: { amountMinor: 1250 },
    });
  });

  it("answers with null for a basket nobody has", async () => {
    const { data } = await ask('{ basket(id: "b-404") { id } }', {}, "live");

    expect(data?.basket).toBeNull();
  });

  it("hands a checkout back with the quote it was frozen at", async () => {
    const { data } = await ask('mutation { checkout(input: { basketId: "b-1" }) { basketId quoteId total { amountMinor currency } } }', {}, "live");

    expect(data?.checkout).toEqual({ basketId: "b-1", quoteId: "q-1", total: { amountMinor: 1250, currency: "GBP" } });
  });

  // A peer that did not answer is not the customer's fault and not a bug in
  // the storefront, and a client that sees "unexpected error" cannot tell.
  it("says which peer failed when one does", async () => {
    const { errors } = await ask('mutation { cancelOrder(input: { id: "o-1" }) { id } }', {}, "live");

    expect(errors?.[0]?.message).toContain("oms");
    expect(errors?.[0]?.extensions).toMatchObject({ code: "PEER_UNAVAILABLE", peer: "oms" });
  });
});
