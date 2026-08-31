import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import {
  addedFields,
  contextStats,
  filterGraph,
  flowsByReach,
  flowsForService,
  headingSlug,
  markdownOutline,
  serviceGraph,
  stepsReferencing,
  usagesOfDef,
} from "./derive";
import { allEvents } from "../catalog";

describe("contextStats", () => {
  it("counts services, aggregates and events per context", () => {
    const shop = catalog.contexts.find((c) => c.id === "shop");
    if (!shop) throw new Error("no shop context");
    const stats = contextStats(shop);
    expect(stats.services).toBe(2);
    expect(stats.aggregates).toBe(4);
    expect(stats.events).toBe(6);
  });

  it("counts unresolved rpc calls and unresolved consumers together", () => {
    const shop = catalog.contexts.find((c) => c.id === "shop");
    const delivery = catalog.contexts.find((c) => c.id === "delivery");
    if (!shop || !delivery) throw new Error("missing contexts");
    // shop: the fraud rpc call, plus OrderPlaced's unknown consumer
    expect(contextStats(shop).unresolved).toBe(2);
    // delivery: ShipmentDelivered's unknown consumer
    expect(contextStats(delivery).unresolved).toBe(1);
  });
});

describe("flowsByReach", () => {
  it("orders flows by number of contexts crossed, widest first", () => {
    const reach = flowsByReach(catalog);
    const counts = reach.map((r) => r.contexts.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(reach[0]?.flow.slug).toBe("checkout");
  });
});

describe("flowsForService", () => {
  it("finds flows by participant id", () => {
    expect(flowsForService(catalog, "shop.pricing").map((f) => f.slug)).toEqual(
      ["checkout"],
    );
    expect(
      flowsForService(catalog, "payments.ledger").map((f) => f.slug),
    ).toEqual([
      "order-accepted",
      "checkout",
      "refund-requested",
      "gateway-webhook",
      "order-cancelled",
    ]);
  });
});

describe("stepsReferencing", () => {
  it("deep-links every step that carries an event ref", () => {
    const refs = stepsReferencing(catalog, "shop.oms.order.OrderPlaced");
    expect(refs.map((r) => `${r.flow.slug}#${r.stepId}`)).toEqual([
      "order-accepted#a2",
      "order-accepted#a3",
      "checkout#s12",
      "checkout#s14",
      "checkout#s15",
    ]);
    // The number is the step's place in the whole flow, frames included.
    expect(refs[2]?.number).toBe(12);
  });
});

describe("serviceGraph", () => {
  it("makes services nodes and event consumption edges", () => {
    const graph = serviceGraph(catalog);
    const real = graph.nodes.filter((n) => !n.ghost).map((n) => n.id);
    expect(real).toEqual([
      "shop.oms",
      "shop.pricing",
      "payments.ledger",
      "delivery.core",
    ]);
    const edge = graph.edges.find(
      (e) =>
        e.from === "payments.ledger" &&
        e.to === "delivery.core" &&
        e.label === "PaymentCaptured",
    );
    expect(edge?.status).toBe("verified");
  });

  it("keeps consumers with no service as ghost nodes", () => {
    const ghosts = serviceGraph(catalog)
      .nodes.filter((n) => n.ghost)
      .map((n) => n.id);
    expect(ghosts).toEqual(["analytics-sink"]);
  });

  it("filters to the chosen contexts and keeps their ghosts", () => {
    const filtered = filterGraph(serviceGraph(catalog), new Set(["delivery"]));
    const ids = filtered.nodes.map((n) => n.id).sort();
    expect(ids).toContain("delivery.core");
    expect(ids).toContain("analytics-sink");
    expect(
      filtered.edges.every(
        (e) => e.from === "delivery.core" || e.to === "delivery.core",
      ),
    ).toBe(true);
  });

  it("returns the whole graph when no context is selected", () => {
    const graph = serviceGraph(catalog);
    expect(filterGraph(graph, new Set())).toBe(graph);
  });
});

describe("markdownOutline", () => {
  it("collects headings and skips fenced code", () => {
    const md = [
      "# Title",
      "",
      "```mermaid",
      "## not a heading",
      "```",
      "",
      "## Real",
      "### Deep",
    ].join("\n");
    expect(markdownOutline(md)).toEqual([
      { depth: 1, text: "Title", slug: "title" },
      { depth: 2, text: "Real", slug: "real" },
      { depth: 3, text: "Deep", slug: "deep" },
    ]);
  });

  it("finds the headings in a real aggregate readme", () => {
    const order = catalog.contexts[0]?.services[0]?.aggregates[0];
    if (!order) throw new Error("no order aggregate");
    const outline = markdownOutline(order.readme);
    expect(outline.map((h) => h.text)).toEqual([
      "Order",
      "Invariants",
      "Commands",
      "Queries",
      "Concurrency",
    ]);
  });

  it("slugs headings safely", () => {
    expect(headingSlug("Non-responsibilities")).toBe("non-responsibilities");
    expect(headingSlug("`PlaceOrder` rules")).toBe("placeorder-rules");
  });
});

describe("addedFields", () => {
  it("reports what a version added over its predecessor", () => {
    const event = allEvents(catalog).find((e) => e.versions.length === 2);
    if (!event) throw new Error("no versioned event");
    expect([...addedFields(event, "v2")]).toEqual(["channel"]);
    expect([...addedFields(event, "v1")]).toEqual([]);
  });
});

describe("usagesOfDef", () => {
  const money = usagesOfDef(catalog, "Money");

  it("finds every event, block, shared type and rpc message naming a type", () => {
    const kinds = new Set(money.map((u) => u.kind));
    expect(kinds).toEqual(new Set(["event", "entity", "vo", "def", "rpc"]));
  });

  it("names the fields that carry the type, not just the thing holding it", () => {
    const placed = money.find((u) => u.id === "shop.oms.order.OrderPlaced");
    expect(placed?.fields).toEqual(["total"]);
    expect(placed?.owner).toBe("shop.oms.order");
    // LineItem holds a Money in unitPrice, so the shared type points at itself.
    const lineItem = money.find((u) => u.kind === "def" && u.id === "LineItem");
    expect(lineItem?.fields).toEqual(["unitPrice"]);
  });

  it("records the versions of an event in which the type appears", () => {
    const versioned = money.filter((u) => (u.versions ?? []).length > 0);
    expect(versioned.length).toBeGreaterThan(0);
    for (const usage of versioned) expect(usage.kind).toBe("event");
  });

  it("lists a block that IS the type with no fields of its own", () => {
    const vo = money.find((u) => u.id === "shop.oms.basket.money");
    expect(vo?.kind).toBe("vo");
    expect(vo?.fields).toEqual([]);
  });

  it("excludes the block that asked, so a page never lists itself", () => {
    const own = usagesOfDef(catalog, "Money", "shop.oms.order.money");
    expect(own.map((u) => u.id)).not.toContain("shop.oms.order.money");
    expect(money.map((u) => u.id)).toContain("shop.oms.order.money");
  });

  it("returns nothing for a type nothing names", () => {
    expect(usagesOfDef(catalog, "Doubloons")).toEqual([]);
  });
});
