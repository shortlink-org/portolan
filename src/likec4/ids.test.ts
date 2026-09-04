import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { catalog } from "../testing/estate";
import {
  allViewIds,
  contextViewId,
  eventFqn,
  flowCrossViewId,
  flowViewId,
  fqn,
  participantFqn,
  safeId,
  serviceViewId,
} from "./ids";

describe("safeId", () => {
  it("replaces characters LikeC4 identifiers cannot hold", () => {
    expect(safeId("fraud-scoring")).toBe("fraud_scoring");
    expect(safeId("price-list")).toBe("price_list");
    expect(safeId("analytics-sink")).toBe("analytics_sink");
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
    expect(fqn("shop.oms.order")).toBe("shop.oms.order");
    expect(eventFqn("shop.oms.order.OrderPlaced")).toBe(
      "shop.oms.order.OrderPlaced",
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
  });

  it("is unique across the whole catalog", () => {
    const ids = allViewIds(catalog);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every context, every service and both flow views, and nothing else", () => {
    const ids = allViewIds(catalog);
    const services = catalog.contexts.flatMap((c) => c.services);
    expect(ids).toHaveLength(
      catalog.contexts.length + services.length + catalog.flows.length * 2,
    );
    // No landscape view: /graph is React Flow's, and no picture is drawn twice.
    expect(ids).not.toContain("landscape");
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
    expect([...declared].sort()).toEqual([...allViewIds(catalog)].sort());
  });

  it("declares no landscape view, since /graph is React Flow's picture", () => {
    expect(declared).not.toContain("landscape");
  });
});
