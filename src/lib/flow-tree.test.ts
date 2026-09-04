import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import type { Flow } from "../catalog";
import {
  GROUP_SHOW_HEAD,
  flowEntry,
  flowHealth,
  flowOwner,
  groupFlowsByOwner,
  reachDots,
  statusCounts,
  visibleEntries,
} from "./flow-tree";

const bySlug = (slug: string): Flow => {
  const flow = catalog.flows.find((f) => f.slug === slug);
  if (!flow) throw new Error(`no flow ${slug}`);
  return flow;
};

describe("flowOwner", () => {
  it("reads the owner off the flow rather than working it out", () => {
    // Every flow states the context it belongs to, because whatever derived it
    // read that context's tree to find it. Nothing here infers.
    expect(flowOwner(bySlug("checkout"))).toBe("shop");
    expect(flowOwner(bySlug("gateway-webhook"))).toBe("payments");
    expect(flowOwner(bySlug("shipment-tracking"))).toBe("delivery");
  });

  it("does not fall back to the lanes when a flow names no owner", () => {
    // The first service lane would happily supply one. Guessing here is what
    // the validator exists to stop, so the flow comes back unowned and the
    // tree files it as a defect.
    const unowned = { ...bySlug("checkout"), owner: undefined } as unknown as Flow;
    expect(flowOwner(unowned)).toBeNull();
  });
});

describe("flowHealth", () => {
  it("is red the moment any step is unresolved", () => {
    expect(flowHealth(bySlug("checkout"))).toBe("unresolved");
    expect(flowHealth(bySlug("order-cancelled"))).toBe("unresolved");
    expect(flowHealth(bySlug("shipment-tracking"))).toBe("unresolved");
  });

  it("is declared while some hop has not been seen running", () => {
    // Written by hand from a design doc: every hop resolves, none observed.
    expect(flowHealth(bySlug("refund-requested"))).toBe("declared");
    // Pinned by a test on three of its four branches; the adopt branch is
    // the one nobody covers, and one unseen message is enough.
    expect(flowHealth(bySlug("gateway-webhook"))).toBe("declared");
  });

  it("is verified once every call in and every message has been seen", () => {
    // order-accepted is pinned by an integration test end to end; the auth
    // flows by the recording in examples/auth/telemetry, which shows the
    // request arriving and the events leaving. The store calls between stay
    // declared, and do not hold the flow back: a query having run is not the
    // claim the code makes about the repository method.
    expect(flowHealth(bySlug("order-accepted"))).toBe("verified");
    expect(flowHealth(bySlug("auth-register-user"))).toBe("verified");
    expect(flowHealth(bySlug("auth-change-password"))).toBe("verified");
  });

  it("is not verified by store calls alone", () => {
    const only = { ...bySlug("auth-get-user"), steps: bySlug("auth-get-user").steps.slice(1) } as Flow;
    // Only the ByID call is left, and a call is never a hop a trace vouches for.
    expect(flowHealth(only)).toBe("declared");
  });

  it("counts steps by status", () => {
    expect(statusCounts(bySlug("auth-login"))).toEqual({ verified: 2, declared: 6, unresolved: 1 });
  });
});

describe("flowEntry", () => {
  it("excludes the owner from the reach, so the dots say where else it goes", () => {
    const entry = flowEntry(bySlug("checkout"));
    expect(entry.reach).not.toContain("shop");
    expect(entry.reach).toEqual(["payments", "delivery"]);
  });
});

describe("groupFlowsByOwner", () => {
  const groups = groupFlowsByOwner(catalog.flows);

  it("files every flow under a context and leaves none unowned", () => {
    expect(groups.map((g) => g.owner)).not.toContain(null);
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    expect(total).toBe(catalog.flows.length);
  });

  it("orders groups by how many flows they hold", () => {
    expect(
      groups.map((g) => [g.owner, g.entries.length] as const),
    ).toEqual([
      ["auth", 7],
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
      "declared",
      "verified",
    ]);
    // Red first, then name: the two unresolved flows are alphabetical.
    expect(shop.entries.slice(0, 2).map((e) => e.flow.name)).toEqual([
      "Checkout",
      "Order cancelled",
    ]);
  });

  it("sends the unowned group to the end, where it reads as a defect", () => {
    const orphan = {
      ...bySlug("checkout"),
      id: "flow.orphan",
      slug: "orphan",
      owner: undefined,
    } as unknown as Flow;
    const withOrphan = groupFlowsByOwner([orphan, ...catalog.flows]);
    expect(withOrphan[withOrphan.length - 1]?.owner).toBeNull();
  });
});

describe("visibleEntries", () => {
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...flowEntry(bySlug("checkout")),
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
