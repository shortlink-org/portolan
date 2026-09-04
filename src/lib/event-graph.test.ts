import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { thinCatalog, wideCatalog } from "./scenarios";
import {
  bundleById,
  bundleId,
  bundles,
  edgeCount,
  eventGraph,
  filterEventGraph,
  parseBundleId,
} from "./event-graph";

const sample = eventGraph(catalog);

describe("eventGraph", () => {
  it("makes a node of every service and every event", () => {
    expect(sample.services.filter((s) => !s.ghost).map((s) => s.id)).toEqual([
      "shop.oms",
      "shop.pricing",
      "payments.ledger",
      "delivery.core",
      // Merge order is source path order, so what examples/auth publishes
      // comes after the hand-written estate.
      "auth.auth",
    ]);
    expect(sample.events.map((e) => e.name)).toContain("PaymentCaptured");
    // One node per event, whatever the consumer count: PaymentCaptured has two
    // consumers and is still one pill.
    const captured = sample.events.filter((e) => e.name === "PaymentCaptured");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.consumers).toHaveLength(2);
  });

  it("keeps consumers with no service of their own as ghosts", () => {
    expect(sample.services.filter((s) => s.ghost).map((s) => s.id)).toEqual([
      "analytics-sink",
    ]);
  });

  it("tints an event by its publisher's context", () => {
    const captured = sample.events.find((e) => e.name === "PaymentCaptured");
    expect(captured?.publisher).toBe("payments.ledger");
    expect(captured?.context).toBe("payments");
  });

  it("counts what each service publishes and consumes", () => {
    const ledger = sample.services.find((s) => s.id === "payments.ledger");
    // PaymentAuthorized, PaymentCaptured, PaymentDeclined, RefundIssued.
    expect(ledger?.publishes).toBe(4);
    // OrderPlaced and OrderCancelled.
    expect(ledger?.consumes).toBe(2);
  });

  it("carries the consumer the traces showed: auth hears its own PasswordChanged", () => {
    // The code declares it only by implication - the revoke-sessions flow
    // opens with the event arriving at auth.auth - and the recording in
    // examples/auth/telemetry shows it happening, which is what makes the
    // edge verified rather than derived.
    const auth = sample.services.find((s) => s.id === "auth.auth");
    expect(auth?.consumes).toBe(1);
    const changed = sample.events.find((e) => e.name === "PasswordChanged");
    expect(changed?.consumers).toMatchObject([
      { service: "auth.auth", status: "verified", self: true },
    ]);
  });

  it("marks self-consumption on the event rather than as an edge", () => {
    const selfConsumed = eventGraph({
      ...catalog,
      contexts: catalog.contexts.map((c) => ({
        ...c,
        services: c.services.map((s) => ({
          ...s,
          aggregates: s.aggregates.map((a) => ({
            ...a,
            events: a.events.map((e) => ({
              ...e,
              consumers: [{ service: s.id, status: "verified" as const }],
            })),
          })),
        })),
      })),
    });
    expect(selfConsumed.events.every((e) => e.consumers[0]?.self)).toBe(true);
    // Never a loop: a self consumption is not a bundle either.
    expect(bundles(selfConsumed)).toEqual([]);
  });
});

describe("filterEventGraph", () => {
  it("returns the graph untouched when no chip is on", () => {
    expect(
      filterEventGraph(sample, { contexts: new Set(), statuses: new Set() }),
    ).toBe(sample);
  });

  it("filters services by context and keeps events with one end left", () => {
    const only = filterEventGraph(sample, {
      contexts: new Set(["delivery"]),
      statuses: new Set(),
    });
    expect(only.services.map((s) => s.id)).toContain("delivery.core");
    expect(only.services.map((s) => s.id)).not.toContain("shop.oms");
    // Everything delivery.core emits survives, and so does everything it is
    // named as a consumer of - the pills that reach it from outside.
    const names = only.events.map((e) => e.name);
    expect(names).toContain("ShipmentDispatched");
    expect(names).toContain("PaymentCaptured");
    // But not traffic it has nothing to do with.
    expect(names).not.toContain("QuoteIssued");
  });

  it("keeps a ghost alive as long as an event still names it", () => {
    const only = filterEventGraph(sample, {
      contexts: new Set(["delivery"]),
      statuses: new Set(),
    });
    expect(only.services.map((s) => s.id)).toContain("analytics-sink");
  });

  it("hides edges of an unwanted status", () => {
    const verified = filterEventGraph(sample, {
      contexts: new Set(),
      statuses: new Set(["verified"] as const),
    });
    const statuses = verified.events.flatMap((e) =>
      e.consumers.map((c) => c.status),
    );
    expect(new Set(statuses)).toEqual(new Set(["verified"]));
  });

  it("hides an event whose every consumption was filtered out", () => {
    const verified = filterEventGraph(sample, {
      contexts: new Set(),
      statuses: new Set(["verified"] as const),
    });
    // QuoteExpired is consumed once, and only as "declared".
    expect(verified.events.map((e) => e.name)).not.toContain("QuoteExpired");
  });

  it("keeps an event that never had a consumer to filter", () => {
    const thin = eventGraph(thinCatalog());
    const verified = filterEventGraph(thin, {
      contexts: new Set(),
      statuses: new Set(["verified"] as const),
    });
    expect(verified.events).toHaveLength(3);
  });

  it("reports how many edges a filter is hiding", () => {
    const before = edgeCount(sample);
    const after = edgeCount(
      filterEventGraph(sample, {
        contexts: new Set(["delivery"]),
        statuses: new Set(),
      }),
    );
    expect(after).toBeLessThan(before);
    expect(before - after).toBeGreaterThan(0);
  });
});

describe("bundles", () => {
  it("collapses every event of a pair into one edge with a count", () => {
    const pair = bundles(sample).find(
      (b) => b.from === "payments.ledger" && b.to === "delivery.core",
    );
    expect(pair?.events.map((e) => e.name).sort()).toEqual([
      "PaymentAuthorized",
      "PaymentCaptured",
      "RefundIssued",
    ]);
    // Worst wins: two of the three are only declared.
    expect(pair?.status).toBe("declared");
  });

  it("draws one edge per ordered pair, never one per event", () => {
    const all = bundles(sample);
    const pairs = new Set(all.map((b) => `${b.from}->${b.to}`));
    expect(pairs.size).toBe(all.length);
  });

  it("flags a pair that publishes both ways so the canvas can offset it", () => {
    const there = bundles(sample).find(
      (b) => b.from === "shop.oms" && b.to === "payments.ledger",
    );
    const back = bundles(sample).find(
      (b) => b.from === "payments.ledger" && b.to === "shop.oms",
    );
    expect(there?.back).toBe(true);
    expect(back?.back).toBe(true);
  });

  it("round-trips its id", () => {
    const id = bundleId("a.b", "c.d");
    expect(parseBundleId(id)).toEqual({ from: "a.b", to: "c.d" });
    expect(parseBundleId("shop.oms")).toBeNull();
    expect(bundleById(sample, id)).toBeNull();
    expect(
      bundleById(sample, bundleId("payments.ledger", "delivery.core"))?.events,
    ).toHaveLength(3);
  });
});

describe("the thin estate", () => {
  const thin = eventGraph(thinCatalog());

  it("is one service and three events with nothing listening", () => {
    expect(thin.services).toHaveLength(1);
    expect(thin.events).toHaveLength(3);
    expect(thin.events.every((e) => e.consumers.length === 0)).toBe(true);
  });

  it("still draws a line from the service to each of its events", () => {
    expect(edgeCount(thin)).toBe(3);
  });

  it("has no bundle at all, because nothing reaches anything", () => {
    expect(bundles(thin)).toEqual([]);
  });
});

describe("the wide estate", () => {
  const wide = eventGraph(wideCatalog());

  it("is forty services and eighty events", () => {
    expect(wide.services.filter((s) => !s.ghost)).toHaveLength(40);
    expect(wide.events).toHaveLength(80);
  });

  it("still has ghosts in it", () => {
    expect(wide.services.filter((s) => s.ghost).length).toBeGreaterThan(0);
  });
});
