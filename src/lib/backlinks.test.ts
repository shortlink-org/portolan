import { describe, expect, it } from "vitest";
import { catalog, index } from "../data";
import { backlinkCount, backlinksFor, stepsInto } from "./backlinks";
import type { BacklinkGroup, BacklinkTarget } from "./backlinks";
import type { Kind } from "./kinds";

function groups(target: BacklinkTarget): BacklinkGroup[] {
  return backlinksFor(catalog, index, target);
}

function of(target: BacklinkTarget, kind: Kind) {
  return groups(target).find((g) => g.kind === kind)?.links ?? [];
}

describe("stepsInto", () => {
  it("numbers steps by their place in the whole flow, frames included", () => {
    const steps = stepsInto(catalog, new Set(["shop.oms.order.OrderPlaced"]));
    expect(steps.map((s) => `${s.flow.slug}#${s.stepId}`)).toEqual([
      "checkout#s12",
      "checkout#s14",
      "checkout#s15",
      "order-accepted#a2",
      "order-accepted#a3",
    ]);
    expect(steps[0]?.number).toBe(12);
  });

  it("takes several events at once and still comes out in flow order", () => {
    const steps = stepsInto(
      catalog,
      new Set([
        "shop.oms.order.OrderPlaced",
        "shop.oms.order.OrderCancelled",
      ]),
    );
    const flows = steps.map((s) => s.flow.slug);
    // Flows in catalog order, never interleaved.
    expect([...new Set(flows)]).toEqual(
      flows.filter((f, i) => flows[i - 1] !== f),
    );
  });
});

describe("an event", () => {
  const target: BacklinkTarget = {
    kind: "event",
    id: "shop.oms.order.OrderPlaced",
  };

  it("is pointed at by its consumers, carrying their status", () => {
    expect(of(target, "service").map((l) => [l.id, l.via, l.status])).toEqual([
      ["payments.ledger", "consumes", "verified"],
      ["shop.pricing", "consumes", "declared"],
      ["analytics-sink", "consumes", "unresolved"],
    ]);
  });

  it("names a consumer the catalog does not have, rather than dropping it", () => {
    const ghost = of(target, "service").find((l) => l.id === "analytics-sink");
    expect(ghost?.owner).toBe("not in the catalog");
    expect(ghost?.context).toBeNull();
  });

  it("points at the step of a flow, not the top of it", () => {
    expect(of(target, "flow").map((l) => `${l.id}#${l.at} ${l.via}`)).toEqual([
      "checkout#s12 step 12",
      "checkout#s14 step 14",
      "checkout#s15 step 15",
      "order-accepted#a2 step 2",
      "order-accepted#a3 step 3",
    ]);
  });

  it("lists the decisions that name it, and says which field named it", () => {
    const adrs = of(
      { kind: "event", id: "shop.cart.basket.BasketCheckedOut" },
      "adr",
    );
    expect(adrs.map((l) => [l.id, l.name, l.via])).toEqual([
      ["org.0002", "ADR-0002", "relates.events"],
    ]);
  });
});

describe("a service", () => {
  const target: BacklinkTarget = { kind: "service", id: "shop.oms" };

  it("is pointed at by its rpc callers — the half its own page never shows", () => {
    const calls = of(target, "service").filter((l) =>
      l.via.startsWith("calls"),
    );
    expect(calls.map((l) => `${l.id} ${l.via}`)).toEqual([
      "shop.pricing calls shop.v1.Orders/GetOrder",
      "payments.ledger calls shop.v1.Orders/GetOrder",
      "delivery.core calls shop.v1.Orders/GetOrder",
    ]);
  });

  it("says which event each listener listens to", () => {
    const heard = of(target, "service").filter((l) =>
      l.via.startsWith("consumes"),
    );
    expect(heard).toContainEqual(
      expect.objectContaining({
        id: "delivery.core",
        via: "consumes OrderConfirmed",
        status: "verified",
      }),
    );
  });

  it("counts a service that listens to two of its events twice, once per event", () => {
    const ledger = of(target, "service").filter(
      (l) => l.id === "payments.ledger" && l.via.startsWith("consumes"),
    );
    expect(ledger.map((l) => l.via)).toEqual([
      "consumes OrderPlaced",
      "consumes OrderCancelled",
    ]);
  });

  it("takes only the decisions that name it — org-wide is not a backlink", () => {
    const adrs = of(target, "adr");
    expect(adrs.map((l) => [l.name, l.via])).toEqual([
      ["ADR-0007", "scope"],
      ["ADR-0003", "scope"],
      ["ADR-0001", "relates.services"],
    ]);
  });

  it("is not its own backlink", () => {
    expect(of(target, "service").every((l) => l.id !== "shop.oms")).toBe(true);
  });
});

describe("a context", () => {
  const target: BacklinkTarget = { kind: "context", id: "shop" };

  it("ignores traffic between its own services", () => {
    // shop.pricing calls shop.oms and listens to it, but both sit inside.
    expect(of(target, "service").every((l) => l.context !== "shop")).toBe(true);
  });

  it("keeps the callers from outside", () => {
    expect(
      of(target, "service")
        .filter((l) => l.via.startsWith("calls"))
        .map((l) => l.id),
    ).toEqual(["payments.ledger", "delivery.core"]);
  });

  it("says which of its participants a flow actually runs through", () => {
    const checkout = of(target, "flow").find((l) => l.id === "checkout");
    // A store the context owns counts: a flow that reaches into it is a flow
    // that depends on this context, whatever kind of participant it is.
    expect(checkout?.via).toBe("shop.oms, oms-db, shop.pricing");
  });
});

describe("an aggregate", () => {
  const target: BacklinkTarget = { kind: "aggregate", id: "shop.oms.order" };

  it("is reached through its events, and every row says which one", () => {
    for (const link of of(target, "service")) {
      expect(link.via).toMatch(/^consumes /);
    }
    for (const link of of(target, "flow")) {
      expect(link.via).toMatch(/^step \d+ · /);
    }
  });

  it("draws a decision naming two of its events once, not twice", () => {
    const ids = of(
      { kind: "aggregate", id: "payments.ledger.payment" },
      "adr",
    ).map((l) => l.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("a value object", () => {
  const money: BacklinkTarget = { kind: "vo", id: "shop.oms.order.money" };

  it("finds the other blocks that name the same shared type", () => {
    const others = of(money, "vo").map((l) => l.id);
    expect(others).toContain("shop.pricing.quote.money");
    expect(others).toContain("payments.ledger.payment.money");
    // Never itself.
    expect(others).not.toContain("shop.oms.order.money");
  });

  it("says which fields carry the type, and in which event versions", () => {
    const events = of(money, "event");
    expect(events.length).toBeGreaterThan(0);
    for (const link of events) expect(link.via).not.toBe("");
    expect(events.some((l) => (l.versions?.length ?? 0) > 0)).toBe(true);
  });

  it("has nothing to find for an inline shape", () => {
    const inline = catalog.contexts
      .flatMap((c) => c.services)
      .flatMap((s) => s.aggregates)
      .flatMap((a) => a.valueObjects)
      .find((b) => !b.ref);
    if (!inline) throw new Error("no inline value object in the catalog");
    expect(backlinkCount(groups({ kind: "vo", id: inline.id }))).toBe(0);
  });
});

describe("a flow", () => {
  it("is pointed at only by the decisions that name it", () => {
    const adrs = of({ kind: "flow", id: "checkout" }, "adr");
    expect(adrs.map((l) => l.name).sort()).toEqual([
      "ADR-0003",
      "ADR-0004",
      "ADR-0007",
    ]);
    for (const link of adrs) expect(link.via).toBe("relates.flows");
  });
});

describe("targets the catalog does not have", () => {
  it("answer nothing rather than throwing", () => {
    for (const kind of [
      "context",
      "service",
      "aggregate",
      "event",
      "vo",
      "flow",
    ] as const) {
      expect(backlinksFor(catalog, index, { kind, id: "nope" })).toEqual([]);
    }
  });

  it("include decision records, whose incoming edges are their banners", () => {
    expect(
      backlinksFor(catalog, index, { kind: "adr", id: "org.0001" }),
    ).toEqual([]);
  });
});

describe("grouping", () => {
  it("orders groups by how loudly they depend, services first", () => {
    const kinds = groups({
      kind: "event",
      id: "shop.oms.order.OrderPlaced",
    }).map((g) => g.kind);
    expect(kinds).toEqual(["service", "flow"]);
  });

  it("counts every link across every group", () => {
    const g = groups({ kind: "service", id: "shop.oms" });
    expect(backlinkCount(g)).toBe(g.reduce((n, x) => n + x.links.length, 0));
  });
});
