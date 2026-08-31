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
