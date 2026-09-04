import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { catalog } from "../testing/estate";
// The generated sources are generated from the estate the app ships, so the
// block that reads them off disk is held against that one and not against the
// frozen fixture the id rules are checked with.
import { catalog as shipped } from "../data";
import {
  LANDSCAPE_VIEW,
  allViewIds,
  contextViewId,
  eventFqn,
  flowCrossViewId,
  flowViewId,
  fqn,
  participantFqn,
  safeId,
  serviceInsideViewId,
  serviceViewId,
} from "./ids";

describe("safeId", () => {
  it("replaces characters LikeC4 identifiers cannot hold", () => {
    expect(safeId("fraud-scoring")).toBe("fraud_scoring");
    expect(safeId("price-list")).toBe("price_list");
    expect(safeId("analytics-sink")).toBe("analytics_sink");
  });

  it("escapes a word the grammar has taken", () => {
    // An aggregate called `order` is what a shop calls its aggregate, and a
    // model that declares one under that name does not parse at all.
    expect(safeId("order")).toBe("_order");
    expect(safeId("style")).toBe("_style");
    expect(safeId("view")).toBe("_view");
  });

  it("never starts an identifier with a digit", () => {
    expect(safeId("2fa")).toBe("_2fa");
  });

  it("leaves already-safe ids alone", () => {
    expect(safeId("OrderPlaced")).toBe("OrderPlaced");
  });
});

describe("fqn", () => {
  it("keeps catalog dots as LikeC4 hierarchy separators", () => {
    expect(fqn("shop.cart.basket")).toBe("shop.cart.basket");
    expect(eventFqn("shop.cart.basket.ItemAdded")).toBe(
      "shop.cart.basket.ItemAdded",
    );
  });

  it("escapes only the segment that needs it", () => {
    // The shop's aggregate is called `order`, and `order` is a word of the
    // LikeC4 grammar; the segments around it are left alone.
    expect(fqn("shop.oms.order")).toBe("shop.oms._order");
    expect(eventFqn("shop.oms.order.OrderPlaced")).toBe(
      "shop.oms._order.OrderPlaced",
    );
  });

  it("sanitises each segment independently", () => {
    expect(fqn("shop.price-list")).toBe("shop.price_list");
  });

  it("maps bare participants to root elements", () => {
    expect(participantFqn("bus")).toBe("bus");
    expect(participantFqn("fraud-scoring")).toBe("fraud_scoring");
  });
});

describe("view ids", () => {
  it("derives ids from catalog slugs, never from dotted ids", () => {
    expect(flowViewId("checkout")).toBe("flow_checkout");
    expect(flowCrossViewId("checkout")).toBe("flow_checkout_cross");
    expect(contextViewId("shop")).toBe("ctx_shop");
    expect(serviceViewId("shop.oms")).toBe("svc_shop_oms");
    expect(serviceInsideViewId("shop.oms")).toBe("svc_shop_oms_inside");
  });

  it("is unique across the whole catalog", () => {
    const ids = allViewIds(catalog);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the landscape, every context, both views of every service and both of every flow", () => {
    const ids = allViewIds(catalog);
    const services = catalog.contexts.flatMap((c) => c.services);
    expect(ids).toHaveLength(
      1 +
        catalog.contexts.length +
        services.length * 2 +
        catalog.flows.length * 2,
    );
    // The three C4 levels: the estate, a context, and a service opened up.
    expect(ids).toContain(LANDSCAPE_VIEW);
    expect(ids).toContain(contextViewId("shop"));
    expect(ids).toContain(serviceInsideViewId("shop.oms"));
  });

  it("produces only valid LikeC4 identifiers", () => {
    for (const id of allViewIds(catalog)) {
      expect(id, id).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });
});

describe("generated sources match the ids the app asks for", () => {
  const views = readFileSync("likec4/views.c4", "utf8");

  /** Every `view x {` and `dynamic view x {` declared in the generated source. */
  const declared = [
    ...views.matchAll(/^\s*(?:dynamic\s+)?view\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm),
  ].map((m) => m[1] as string);

  it("declares exactly the views the app can ask for, no more and no fewer", () => {
    expect([...declared].sort()).toEqual([...allViewIds(shipped)].sort());
  });

  it("declares the landscape once, and it is the only view with a fixed name", () => {
    expect(declared.filter((id) => id === LANDSCAPE_VIEW)).toHaveLength(1);
  });
});
