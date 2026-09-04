import { describe, expect, it } from "vitest";
import { sameVisit, visitFor, visitSubject, visitTo } from "./model";

const subject = (path: string, id?: string) =>
  visitSubject({
    path,
    selection: id ? { kind: "unknown", id } : null,
  });

describe("visitFor", () => {
  it("records entity pages", () => {
    expect(visitFor("/c/shop/oms", null)).toEqual({
      path: "/c/shop/oms",
      selection: null,
    });
  });

  /**
   * The overview, the two index lists and the two whole-estate views are one
   * click away from the chrome that is always on screen. A trail that spends
   * its slots on them has fewer left for the leaves nobody can get back to.
   */
  it("ignores the pages the chrome already reaches", () => {
    for (const path of [
      "/",
      "/flows",
      "/adrs",
      "/graph",
      "/map",
      "/problems",
    ]) {
      expect(visitFor(path, null)).toBeNull();
    }
  });

  it("ignores a page the catalog does not know", () => {
    expect(visitFor("/c/shop/nope", null)).toBeNull();
    expect(visitFor("/adrs/not-a-decision", null)).toBeNull();
  });
});

describe("visitSubject from the path", () => {
  it("names each level of the catalog", () => {
    expect(subject("/c/shop")).toEqual({
      kind: "context",
      label: "shop",
      contextId: "shop",
    });
    expect(subject("/c/shop/oms")).toEqual({ kind: "service", label: "oms" });
    expect(subject("/c/shop/oms/order")).toEqual({
      kind: "aggregate",
      label: "order",
    });
    expect(subject("/c/shop/oms/order/order-placed")).toEqual({
      kind: "event",
      label: "OrderPlaced",
    });
  });

  it("reads the block literals rather than the slug behind them", () => {
    expect(subject("/c/shop/oms/order/vo/money")).toEqual({
      kind: "vo",
      label: "Money",
    });
    expect(subject("/c/shop/oms/order/entity/order")).toEqual({
      kind: "entity",
      label: "Order",
    });
  });

  it("names flows and decisions, which have no selection of their own", () => {
    expect(subject("/flows/cart-checkout")).toEqual({
      kind: "flow",
      label: "cart-checkout",
    });
    expect(subject("/adrs/payments-0004-idempotent-journal-entries")).toEqual({
      kind: "adr",
      label: "ADR-0004",
    });
  });
});

describe("visitSubject from the selection", () => {
  /**
   * An event picked on a service diagram is what the reader was looking at,
   * even though the route still says the service. The chip says so, and going
   * back to it puts the event under them again.
   */
  it("prefers what was selected over what the route says", () => {
    expect(subject("/c/shop/oms", "shop.oms.order.OrderPlaced")).toEqual({
      kind: "event",
      label: "OrderPlaced",
    });
  });

  it("carries the step number for a flow", () => {
    expect(subject("/flows/cart-checkout", "cart-checkout/s1")).toEqual({
      kind: "flow",
      label: "cart-checkout · 1",
    });
  });

  it("falls back to the page when the selection is gone", () => {
    expect(subject("/c/shop/oms", "shop.oms.order.Deleted")).toEqual({
      kind: "service",
      label: "oms",
    });
  });

  it("is null when neither the selection nor the page survives", () => {
    expect(subject("/c/gone/nowhere", "nothing.at.all")).toBeNull();
  });
});

describe("identity", () => {
  /**
   * Thirteen steps of one flow are thirteen selections on one page. They share
   * a slot, or a single flow fills the whole trail.
   */
  it("is the page, so steps of one flow collapse", () => {
    const a = { path: "/flows/cart-checkout", selection: null };
    const b = {
      path: "/flows/cart-checkout",
      selection: { kind: "flow-step" as const, id: "cart-checkout/s1" },
    };
    expect(sameVisit(a, b)).toBe(true);
    expect(
      sameVisit(a, { path: "/flows/auth-login", selection: null }),
    ).toBe(false);
  });

  it("goes back to the selection it was left on", () => {
    expect(
      visitTo({
        path: "/c/shop/oms",
        selection: { kind: "event", id: "shop.oms.order.OrderPlaced" },
      }),
    ).toBe("/c/shop/oms#sel=event:shop.oms.order.OrderPlaced");
    expect(visitTo({ path: "/c/shop/oms", selection: null })).toBe(
      "/c/shop/oms",
    );
  });
});

describe("a module in the trail", () => {
  // The registry index is chrome, not an entity: a reader gets back to it from
  // the sidebar, which is the rule the whole trail is built on.
  it("does not record the registry index as a visit", () => {
    expect(visitFor("/registry", null)).toBeNull();
  });

  // Every lookup goes to the catalog, so a slug it does not hold is null
  // rather than a chip labelled with a URL fragment.
  it("does not record a module page for a slug the catalog does not hold", () => {
    expect(visitFor("/registry/acme-shop", null)).toBeNull();
  });
});
