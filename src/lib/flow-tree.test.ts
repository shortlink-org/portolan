import { describe, expect, it } from "vitest";
import { catalog, index } from "../data";
import type { Flow } from "../catalog";
import {
  GROUP_SHOW_HEAD,
  flowEntry,
  flowHealth,
  flowOwner,
  groupFlowsByOwner,
  reachDots,
  visibleEntries,
} from "./flow-tree";

const bySlug = (slug: string): Flow => {
  const flow = catalog.flows.find((f) => f.slug === slug);
  if (!flow) throw new Error(`no flow ${slug}`);
  return flow;
};

describe("flowOwner", () => {
  it("reads a derived-from-test flow's owner off the service its source sits under", () => {
    // services/oms/test/e2e/checkout_test.go is shop.oms's tree.
    expect(flowOwner(bySlug("checkout"), index)).toBe("shop");
    expect(flowOwner(bySlug("order-accepted"), index)).toBe("shop");
    // services/ledger/... belongs to payments.
    expect(flowOwner(bySlug("gateway-webhook"), index)).toBe("payments");
  });

  it("takes an authored flow's owner from the field, not from its participants", () => {
    const refund = bySlug("refund-requested");
    expect(refund.provenance).toBe("authored");
    // Its first service participant is shop.oms and its owner happens to agree,
    // so state the mechanism rather than the coincidence.
    expect(flowOwner({ ...refund, owner: "delivery" }, index)).toBe("delivery");
    expect(flowOwner(refund, index)).toBe("shop");
  });

  it("takes a traced flow's owner from the first service lane, skipping actors and externals", () => {
    // shipment-tracking opens on a customer and a carrier API before it
    // reaches delivery.core.
    expect(flowOwner(bySlug("shipment-tracking"), index)).toBe("delivery");
  });

  it("owns nothing when the rule for that provenance cannot be applied", () => {
    const orphan: Flow = {
      ...bySlug("checkout"),
      source: "some/other/repo/thing_test.go",
    };
    expect(flowOwner(orphan, index)).toBeNull();

    const sourceless: Flow = { ...bySlug("checkout") };
    delete sourceless.source;
    expect(flowOwner(sourceless, index)).toBeNull();
  });

  it("does not fall back between provenances", () => {
    // An authored flow with no owner stays unowned even though its lanes would
    // happily supply one. Guessing here is what the validator exists to stop.
    const authored: Flow = {
      ...bySlug("checkout"),
      provenance: "authored",
    };
    delete authored.owner;
    expect(flowOwner(authored, index)).toBeNull();
  });
});

describe("flowHealth", () => {
  it("is red the moment any step is unresolved, however much else is verified", () => {
    expect(flowHealth(bySlug("checkout"))).toBe("unresolved");
    expect(flowHealth(bySlug("order-cancelled"))).toBe("unresolved");
    expect(flowHealth(bySlug("shipment-tracking"))).toBe("unresolved");
  });

  it("is green only when every step has been observed", () => {
    expect(flowHealth(bySlug("order-accepted"))).toBe("verified");
  });

  it("is amber when verified and declared steps sit side by side", () => {
    expect(flowHealth(bySlug("gateway-webhook"))).toBe("mixed");
  });

  it("separates 'nothing verified' from 'partly verified'", () => {
    // Every step declared and none observed is not the same claim as a flow
    // half of which has been watched running.
    expect(flowHealth(bySlug("refund-requested"))).toBe("unverified");
  });
});

describe("flowEntry", () => {
  it("excludes the owner from the reach, so the dots say where else it goes", () => {
    const entry = flowEntry(bySlug("checkout"), index);
    expect(entry.reach).not.toContain("shop");
    expect(entry.reach).toEqual(["payments", "delivery"]);
  });
});

describe("groupFlowsByOwner", () => {
  const groups = groupFlowsByOwner(catalog.flows, index);

  it("files every flow under a context and leaves none unowned", () => {
    expect(groups.map((g) => g.owner)).not.toContain(null);
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    expect(total).toBe(catalog.flows.length);
  });

  it("orders groups by how many flows they hold", () => {
    expect(
      groups.map((g) => [g.owner, g.entries.length] as const),
    ).toEqual([
      ["shop", 4],
      ["delivery", 1],
      ["payments", 1],
    ]);
  });

  it("puts the broken flows at the top of their group", () => {
    const shop = groups.find((g) => g.owner === "shop");
    if (!shop) throw new Error("no shop group");
    expect(shop.entries.map((e) => e.health)).toEqual([
      "unresolved",
      "unresolved",
      "unverified",
      "verified",
    ]);
    // Red first, then name: the two unresolved flows are alphabetical.
    expect(shop.entries.slice(0, 2).map((e) => e.flow.name)).toEqual([
      "Checkout",
      "Order cancelled",
    ]);
  });

  it("sends the unowned group to the end, where it reads as a defect", () => {
    const orphan: Flow = {
      ...bySlug("checkout"),
      id: "flow.orphan",
      slug: "orphan",
      source: "nowhere/at/all_test.go",
    };
    const withOrphan = groupFlowsByOwner([orphan, ...catalog.flows], index);
    expect(withOrphan[withOrphan.length - 1]?.owner).toBeNull();
  });
});

describe("visibleEntries", () => {
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...flowEntry(bySlug("checkout"), index),
      flow: { ...bySlug("checkout"), slug: `f${i}` },
    }));

  it("lists a group whole while it still reads as a list", () => {
    const eight = entries(8);
    expect(visibleEntries(eight)).toEqual({ shown: eight, hidden: 0 });
  });

  it("stops listing past the limit and says how many it stopped at", () => {
    const nine = entries(9);
    const { shown, hidden } = visibleEntries(nine);
    expect(shown).toHaveLength(GROUP_SHOW_HEAD);
    expect(hidden).toBe(4);
  });
});

describe("reachDots", () => {
  it("draws every context when three or fewer", () => {
    expect(reachDots(["a", "b", "c"])).toEqual({
      dots: ["a", "b", "c"],
      more: 0,
    });
  });

  it("counts the rest rather than drawing an unreadable row of dots", () => {
    expect(reachDots(["a", "b", "c", "d", "e"])).toEqual({
      dots: ["a", "b", "c"],
      more: 2,
    });
  });
});
