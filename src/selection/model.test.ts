import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { allEvents, allServices, walkSteps } from "../catalog";
import {
  classify,
  flowStepId,
  parseFlowStepId,
  resolveSelection,
  sameSelection,
  selectionFor,
  selectionLabel,
  selectionTrail,
} from "./model";
import { parseSelectionHash, selectionHash } from "./hash";

describe("classify", () => {
  it("derives the kind from the id, for every id the catalog holds", () => {
    for (const context of catalog.contexts) {
      expect(classify(context.id), context.id).toBe("context");
      for (const service of context.services) {
        expect(classify(service.id), service.id).toBe("service");
        for (const aggregate of service.aggregates) {
          expect(classify(aggregate.id), aggregate.id).toBe("aggregate");
          for (const event of aggregate.events) {
            expect(classify(event.id), event.id).toBe("event");
          }
        }
      }
    }
    for (const defId of Object.keys(catalog.defs)) {
      expect(classify(defId), defId).toBe("value-object");
    }
  });

  it("classifies every step of every flow", () => {
    for (const flow of catalog.flows) {
      for (const step of walkSteps(flow.steps)) {
        const id = flowStepId(flow.slug, step.id);
        expect(classify(id), id).toBe("flow-step");
      }
    }
  });

  // An external participant is drawn but not catalogued. The click still has
  // to land somewhere, so it lands on "unknown" rather than being dropped.
  it("falls back to unknown rather than refusing an id", () => {
    expect(classify("analytics-sink")).toBe("unknown");
    expect(classify("")).toBe("unknown");
    expect(selectionFor("analytics-sink")).toEqual({
      kind: "unknown",
      id: "analytics-sink",
    });
  });

  it("does not mistake a missing flow or step for a flow step", () => {
    expect(classify("checkout/s999")).toBe("unknown");
    expect(classify("no-such-flow/s1")).toBe("unknown");
  });
});

describe("flow step ids", () => {
  it("round-trips through the flow slug", () => {
    expect(parseFlowStepId(flowStepId("checkout", "s6"))).toEqual({
      flowSlug: "checkout",
      stepId: "s6",
    });
  });

  it("rejects anything that is not two halves", () => {
    expect(parseFlowStepId("checkout")).toBeNull();
    expect(parseFlowStepId("/s6")).toBeNull();
    expect(parseFlowStepId("checkout/")).toBeNull();
  });
});

describe("resolveSelection", () => {
  it("carries the whole ancestry of an event", () => {
    const resolved = resolveSelection("shop.oms.order.OrderPlaced");
    expect(resolved?.kind).toBe("event");
    if (resolved?.kind !== "event") throw new Error("unreachable");
    expect(resolved.aggregate.id).toBe("shop.oms.order");
    expect(resolved.service.id).toBe("shop.oms");
    expect(resolved.context.id).toBe("shop");
  });

  it("numbers a flow step the way the rail numbers it", () => {
    const resolved = resolveSelection(flowStepId("checkout", "s6"));
    expect(resolved?.kind).toBe("flow-step");
    if (resolved?.kind !== "flow-step") throw new Error("unreachable");
    expect(resolved.number).toBe(6);
    expect(resolved.step.id).toBe("s6");
  });

  it("resolves every service and event in the catalog", () => {
    for (const service of allServices(catalog)) {
      expect(resolveSelection(service.id)?.kind, service.id).toBe("service");
    }
    for (const event of allEvents(catalog)) {
      expect(resolveSelection(event.id)?.kind, event.id).toBe("event");
    }
  });
});

describe("selectionTrail", () => {
  it("walks context to event", () => {
    const trail = selectionTrail(selectionFor("shop.oms.order.OrderPlaced"));
    expect(trail.map((s) => s.id)).toEqual([
      "shop",
      "shop.oms",
      "shop.oms.order",
      "shop.oms.order.OrderPlaced",
    ]);
    expect(trail.map(selectionLabel)).toEqual([
      "shop",
      "oms",
      "order",
      "OrderPlaced",
    ]);
  });

  it("leaves things with no ancestry alone", () => {
    expect(selectionTrail(selectionFor("Money")).map((s) => s.id)).toEqual([
      "Money",
    ]);
    const step = selectionFor(flowStepId("checkout", "s6"));
    expect(selectionTrail(step)).toEqual([step]);
  });
});

describe("views and their columns", () => {
  it("classifies a view and a view's column by id", () => {
    expect(classify("shop.oms.pg.v_open_orders")).toBe("view");
    expect(classify("shop.oms.pg.v_open_orders.total_minor")).toBe("column");
  });

  it("resolves a view column to its view, with no table pretending to hold it", () => {
    const resolved = resolveSelection("shop.oms.pg.v_open_orders.total_minor");
    expect(resolved?.kind).toBe("column");
    if (resolved?.kind !== "column") throw new Error("expected a column");
    expect(resolved.view?.name).toBe("v_open_orders");
    expect(resolved.table).toBeNull();
    expect(resolved.store.id).toBe("shop.oms.pg");
  });

  it("walks a view column back through its view rather than a table", () => {
    const trail = selectionTrail(
      selectionFor("shop.oms.pg.v_open_orders.total_minor"),
    );
    expect(trail.map((s) => s.id)).toEqual([
      "shop",
      "shop.oms",
      "shop.oms.pg",
      "shop.oms.pg.v_open_orders",
      "shop.oms.pg.v_open_orders.total_minor",
    ]);
    expect(trail.map((s) => s.kind)).toEqual([
      "context",
      "service",
      "store",
      "view",
      "column",
    ]);
  });
});

describe("sameSelection", () => {
  it("compares by value, and treats null as its own value", () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(null, selectionFor("shop"))).toBe(false);
    expect(sameSelection(selectionFor("shop"), selectionFor("shop"))).toBe(
      true,
    );
    expect(sameSelection(selectionFor("shop"), selectionFor("shop.oms"))).toBe(
      false,
    );
  });
});

describe("selecting a module", () => {
  // The scenario's ids have to be resolvable through the app's own index, and
  // the app's index is built from data/catalog.json - which has no modules.
  // So this asserts the shape of the rule rather than the sample.
  it("classifies an id the catalog does not hold as unknown", () => {
    expect(classify("buf.build/acme/nowhere")).toBe("unknown");
  });

  // The kind in a hash is only a hint - it is always re-derived from the id -
  // but the kind must still be one `parseSelectionHash` recognises. Leaving
  // "module" out of its list would make every module deep link return null and
  // die silently, which is the failure mode worth a test.
  it("is a kind a selection hash can carry, slash and all", () => {
    const id = "buf.build/acme/shop";
    const hash = selectionHash({ kind: "module", id });

    // The slashes in a module id are escaped; the separator is not.
    expect(hash).toBe("#sel=module:buf.build%2Facme%2Fshop");
    expect(parseSelectionHash(hash)?.id).toBe(id);
  });
});
