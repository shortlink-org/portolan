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
import { registryCatalog } from "./lib/scenarios";

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
    expect(blockPath("shop.oms.order.line")).toBe(
      "/c/shop/oms/order/entity/line",
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
    expect(viewPath("payments.ledger.pg.v_payment_state")).toBe(
      "/c/payments/ledger/data/pg#sel=view:payments.ledger.pg.v_payment_state",
    );
    // A view is not a table and vice versa, so neither answers for the other.
    expect(viewPath("shop.oms.pg.orders")).toBeNull();
    expect(tablePath("payments.ledger.pg.v_payment_state")).toBeNull();
  });

  it("carries a view through the hash as a view", () => {
    const link = viewPath("delivery.core.pg.mv_route_load") as string;
    expect(parseSelectionHash(link.slice(link.indexOf("#")))).toEqual({
      kind: "view",
      id: "delivery.core.pg.mv_route_load",
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
    const link = paths.flowStep("cart-checkout", "s6");
    expect(link).toBe("/flows/cart-checkout#sel=flow-step:cart-checkout%2Fs6");
    expect(isRoutable(link)).toBe(true);
    expect(parseSelectionHash(link.slice(link.indexOf("#")))).toEqual({
      kind: "flow-step",
      id: "cart-checkout/s6",
    });
  });
});

describe("registry routes", () => {
  const registry = registryCatalog();

  it("routes every module path the catalog can produce", () => {
    const unroutable = allCatalogPaths(registry).filter((p) => !isRoutable(p));

    expect(unroutable).toEqual([]);
  });

  it("puts a module at one URL, keyed by its slug", () => {
    expect(paths.module("acme-shop")).toBe("/registry/acme-shop");
    expect(paths.registry()).toBe("/registry");
  });

  // A module slug is one segment. A dotted or slashed one would break the
  // assertion above about URL segments, and would make `/registry/:module`
  // stop matching.
  it("never lets a module slug carry a dot or a slash", () => {
    for (const module of registry.modules ?? []) {
      expect(module.slug, module.id).not.toContain(".");
      expect(module.slug, module.id).not.toContain("/");
    }
  });

  it("refuses a path with too few or too many segments", () => {
    expect(isRoutable("/registry")).toBe(true);
    expect(isRoutable("/registry/acme-shop")).toBe(true);
    expect(isRoutable("/registry/acme-shop/extra")).toBe(false);
  });

  it("lists /registry even for an estate that has published nothing", () => {
    expect(allCatalogPaths(catalog)).toContain("/registry");
  });
});
