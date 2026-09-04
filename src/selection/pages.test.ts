import { describe, expect, it } from "vitest";
import { pageContains, selectionPath } from "./pages";
import { selectionFor } from "./model";

const dispatched = selectionFor("delivery.core.shipment.ShipmentDispatched");
const shipment = selectionFor("delivery.core.shipment");
const money = selectionFor("Money");

describe("pageContains", () => {
  it("holds an aggregate's events on the aggregate page", () => {
    expect(pageContains("/c/delivery/core/shipment", dispatched)).toBe(true);
    expect(pageContains("/c/delivery/core/shipment", shipment)).toBe(true);
  });

  // The literal segment is not an event slug. Without this a block page claims
  // to hold every event of its aggregate, and the palette refuses to navigate.
  it("holds nothing on a value object or entity page", () => {
    expect(
      pageContains("/c/delivery/core/shipment/entity/parcel", dispatched),
    ).toBe(false);
    expect(
      pageContains("/c/delivery/core/shipment/entity/parcel", shipment),
    ).toBe(false);
    expect(pageContains("/c/shop/oms/order/vo/money", money)).toBe(false);
  });

  it("still reads a four-segment path as an event page", () => {
    const delivered = selectionFor("delivery.core.shipment.ShipmentDelivered");
    expect(
      pageContains("/c/delivery/core/shipment/shipment-delivered", delivered),
    ).toBe(true);
    expect(
      pageContains("/c/delivery/core/shipment/shipment-delivered", dispatched),
    ).toBe(false);
  });
});

describe("selectionPath", () => {
  it("sends an event to its own page and a shared type nowhere", () => {
    expect(selectionPath(dispatched)).toBe(
      "/c/delivery/core/shipment/shipment-dispatched",
    );
    expect(selectionPath(money)).toBeNull();
  });
});

// Navigation keeps a selection only when the page it lands on can point at it.
// These are the cases that decide whether the palette moves the reader.
describe("pageContains across pages", () => {
  const orderPlaced = selectionFor("shop.oms.order.OrderPlaced");
  const oms = selectionFor("shop.oms");
  const step = selectionFor("cart-checkout/s6");

  it("keeps an event on the flow that carries it, and drops it elsewhere", () => {
    expect(pageContains("/flows/oms-place-order-on-basket-checked-out", orderPlaced)).toBe(true);
    expect(pageContains("/flows/shipment-tracking", orderPlaced)).toBe(false);
  });

  it("keeps a service on its own page and on its context page", () => {
    expect(pageContains("/c/shop/oms", oms)).toBe(true);
    expect(pageContains("/c/shop", oms)).toBe(true);
    expect(pageContains("/c/payments", oms)).toBe(false);
  });

  // The rule the palette leans on: an event picked while its service page is
  // open opens the panel, because the page already holds it.
  it("keeps an event on the pages above it", () => {
    expect(pageContains("/c/shop/oms", orderPlaced)).toBe(true);
    expect(pageContains("/c/shop/oms/order", orderPlaced)).toBe(true);
    expect(pageContains("/c/shop/pricing", orderPlaced)).toBe(false);
  });

  it("binds a step to its own flow", () => {
    expect(pageContains("/flows/cart-checkout", step)).toBe(true);
    expect(pageContains("/flows/auth-login", step)).toBe(false);
  });

  it("holds services and events on the dependency graph", () => {
    expect(pageContains("/graph", oms)).toBe(true);
    expect(pageContains("/graph", orderPlaced)).toBe(true);
    expect(pageContains("/graph", step)).toBe(false);
  });

  it("holds nothing on the pages that draw no diagram", () => {
    for (const path of ["/", "/flows", "/adrs", "/adrs/anything"]) {
      expect(pageContains(path, oms), path).toBe(false);
      expect(pageContains(path, orderPlaced), path).toBe(false);
    }
  });

  it("ignores a query string and a hash when matching", () => {
    expect(pageContains("/c/shop/oms?tab=consumes", oms)).toBe(true);
    expect(pageContains("/c/shop/oms#sel=service:shop.oms", oms)).toBe(true);
  });
});

describe("the registry pages", () => {
  // A module page draws one module. It LINKS to the services that read it, and
  // a page contains what it draws rather than everything it points at.
  it("contains only the module whose page it is", () => {
    const mine = { kind: "module" as const, id: "buf.build/acme/shop" };

    // Resolution goes through the app's own catalog, which has no modules -
    // so an id it cannot resolve is contained by nothing, anywhere.
    expect(pageContains("/registry/acme-shop", mine)).toBe(false);
    expect(pageContains("/c/shop/oms", mine)).toBe(false);
  });

  it("does not think a service page is a registry page", () => {
    const service = { kind: "service" as const, id: "shop.oms" };

    expect(pageContains("/registry", service)).toBe(false);
    expect(pageContains("/registry/acme-shop", service)).toBe(false);
  });
});
