import { describe, expect, it } from "vitest";
import { catalog } from "./data";
import { walkSteps } from "./catalog";
import {
  adrPath,
  allCatalogPaths,
  blockPath,
  eventPath,
  isRoutable,
  paths,
  servicePath,
  tablePath,
  viewPath,
} from "./routes";
import { parseSelectionHash } from "./selection/hash";
import { allAggregates, allStores, allViews } from "./catalog";

describe("routes", () => {
  it("routes every URL the catalog can produce", () => {
    const unroutable = allCatalogPaths(catalog).filter((p) => !isRoutable(p));
    expect(unroutable).toEqual([]);
  });

  it("never puts a dotted id in a URL segment", () => {
    for (const path of allCatalogPaths(catalog)) {
      const segments = path.split("/").filter(Boolean);
      // the context segment is a plain id; service/aggregate/event are slugs
      for (const segment of segments.slice(2)) {
        expect(segment, `dotted segment in ${path}`).not.toContain(".");
      }
    }
  });

  it("resolves every event referenced by a flow step to a page", () => {
    for (const flow of catalog.flows) {
      for (const step of walkSteps(flow.steps)) {
        if (step.kind !== "event" || !step.ref) continue;
        const path = eventPath(step.ref);
        expect(path, `${flow.slug}/${step.id} -> ${step.ref}`).not.toBeNull();
        expect(isRoutable(path as string)).toBe(true);
      }
    }
  });

  it("resolves every flow participant that is a catalog service", () => {
    for (const flow of catalog.flows) {
      for (const participant of flow.participants) {
        if (participant.kind !== "service") continue;
        const path = servicePath(participant.id);
        expect(
          path,
          `${flow.slug} participant ${participant.id}`,
        ).not.toBeNull();
      }
    }
  });

  it("routes every value object and entity, behind its own literal segment", () => {
    for (const aggregate of allAggregates(catalog)) {
      for (const block of [...aggregate.valueObjects, ...aggregate.entities]) {
        const path = blockPath(block.id);
        expect(path, block.id).not.toBeNull();
        expect(isRoutable(path as string), path as string).toBe(true);
      }
    }
    expect(blockPath("shop.oms.order.money")).toBe(
      "/c/shop/oms/order/vo/money",
    );
    expect(blockPath("shop.oms.order.order-line")).toBe(
      "/c/shop/oms/order/entity/order-line",
    );
  });

  // Both are five segments deep, so nothing may fall through to the event route.
  it("keeps block pages and event pages apart", () => {
    expect(isRoutable("/c/shop/oms/order/vo/money")).toBe(true);
    expect(isRoutable("/c/shop/oms/order/order-placed")).toBe(true);
    expect(isRoutable("/c/shop/oms/order/vo")).toBe(true); // an event slug "vo"
    expect(isRoutable("/c/shop/oms/order/vo/money/extra")).toBe(false);
  });

  it("returns null rather than a broken link for unknown ids", () => {
    expect(servicePath("analytics-sink")).toBeNull();
    expect(eventPath("nope.nope.Nope")).toBeNull();
    expect(adrPath("shop.oms.0099")).toBeNull();
    expect(blockPath("shop.oms.order.doubloons")).toBeNull();
  });

  it("routes every decision record, by slug rather than by id", () => {
    for (const adr of catalog.adrs) {
      const path = adrPath(adr.id);
      expect(path, adr.id).toBe(`/adrs/${adr.slug}`);
      expect(isRoutable(path as string)).toBe(true);
    }
    expect(isRoutable("/adrs")).toBe(true);
  });

  it("links every supersession to a routable page", () => {
    for (const adr of catalog.adrs) {
      for (const id of [adr.supersededBy, ...(adr.supersedes ?? [])]) {
        if (!id) continue;
        expect(adrPath(id), `${adr.id} -> ${id}`).not.toBeNull();
      }
    }
  });

  it("opens a view on the canvas of the store that declares it", () => {
    for (const view of allViews(catalog)) {
      const path = viewPath(view.id);
      expect(path, view.id).not.toBeNull();
      expect(isRoutable(path as string), path as string).toBe(true);
    }
    expect(viewPath("shop.oms.pg.v_open_orders")).toBe(
      "/c/shop/oms/data/pg#sel=view:shop.oms.pg.v_open_orders",
    );
    // A view is not a table and vice versa, so neither answers for the other.
    expect(viewPath("shop.oms.pg.orders")).toBeNull();
    expect(tablePath("shop.oms.pg.v_open_orders")).toBeNull();
  });

  it("carries a view through the hash as a view", () => {
    const link = viewPath("shop.oms.pg.mv_orders_daily") as string;
    expect(parseSelectionHash(link.slice(link.indexOf("#")))).toEqual({
      kind: "view",
      id: "shop.oms.pg.mv_orders_daily",
    });
  });

  it("has a store for every view, so no view is orphaned", () => {
    const stores = new Set(allStores(catalog).map((s) => s.id));
    for (const view of allViews(catalog)) {
      expect(stores.has(view.id.split(".").slice(0, -1).join("."))).toBe(true);
    }
  });

  it("ignores query strings when matching routes", () => {
    expect(isRoutable("/c/shop/oms?tab=consumes")).toBe(true);
    expect(isRoutable("/nope/nope/nope/nope/nope")).toBe(false);
  });

  it("builds deep links to steps, carrying the step as a selection", () => {
    const link = paths.flowStep("checkout", "s6");
    expect(link).toBe("/flows/checkout#sel=flow-step:checkout%2Fs6");
    expect(isRoutable(link)).toBe(true);
    expect(parseSelectionHash(link.slice(link.indexOf("#")))).toEqual({
      kind: "flow-step",
      id: "checkout/s6",
    });
  });
});
