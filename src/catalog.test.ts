import { describe, expect, it } from "vitest";
import raw from "../data/catalog.json";
import {
  CatalogError,
  allAggregates,
  allEvents,
  blockFields,
  buildIndex,
  flowCoverage,
  rootEntity,
  stepConditions,
  stepFrames,
  validateCatalog,
  walkSteps,
} from "./catalog";
import type { Adr, Alt, Catalog, Flow } from "./catalog";

const catalog = raw as unknown as Catalog;

function clone(): Catalog {
  return JSON.parse(JSON.stringify(catalog)) as Catalog;
}

describe("validateCatalog", () => {
  it("accepts the shipped catalog", () => {
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it("rejects a step whose participant was never declared, naming flow and step", () => {
    const bad = clone();
    const checkout = bad.flows.find((f) => f.slug === "checkout") as Flow;
    const step = walkSteps(checkout.steps)[0];
    if (!step) throw new Error("fixture has no steps");
    step.to = "warehouse";
    expect(() => validateCatalog(bad)).toThrowError(CatalogError);
    expect(() => validateCatalog(bad)).toThrowError(
      /flow "checkout" step "s1".*warehouse/s,
    );
  });

  it("rejects an unresolvable ref unless the step is unresolved", () => {
    const bad = clone();
    const flow = bad.flows[0] as Flow;
    const step = walkSteps(flow.steps)[0];
    if (!step) throw new Error("fixture has no steps");
    step.ref = "shop.oms.order.NoSuchEvent";
    expect(() => validateCatalog(bad)).toThrowError(
      /resolves to neither an Event nor an RpcCall/,
    );
    step.status = "unresolved";
    expect(() => validateCatalog(bad)).not.toThrow();
  });

  it("rejects a field ref that is not a defs key", () => {
    const bad = clone();
    const field =
      bad.contexts[0]?.services[0]?.aggregates[0]?.events[0]?.versions[0]
        ?.fields[0];
    if (!field) throw new Error("fixture has no fields");
    field.ref = "Nonexistent";
    expect(() => validateCatalog(bad)).toThrowError(
      /references unknown def "Nonexistent"/,
    );
  });

  it("rejects duplicate slugs within a parent", () => {
    const bad = clone();
    const services = bad.contexts[0]?.services;
    if (!services || !services[0] || !services[1])
      throw new Error("fixture too small");
    services[1].slug = services[0].slug;
    services[1].id = services[0].id;
    expect(() => validateCatalog(bad)).toThrowError(
      /service slug .* is not unique/,
    );
  });
});

describe("stepFrames", () => {
  const checkout = catalog.flows.find((f) => f.slug === "checkout") as Flow;
  const frames = stepFrames(checkout.steps);

  it("gives a step outside every frame an empty stack", () => {
    expect(frames.get("s3")).toEqual([]);
  });

  it("stacks the frames around a step, outermost first", () => {
    expect(frames.get("s4")).toEqual([
      {
        kind: "alt",
        id: "alt-risk",
        branch: "risk score below threshold",
        terminal: undefined,
      },
      {
        kind: "parallel",
        id: "par-authorise",
        title: "authorise and announce",
        branch: "1",
      },
    ]);
  });

  it("carries the terminal flag onto the steps of the branch that ends", () => {
    const stack = frames.get("s7") ?? [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.terminal).toBe(true);
    expect(stepConditions(stack).map((f) => f.branch)).toEqual([
      "risk score above threshold",
    ]);
  });

  it("reports a loop as a frame but not as a condition", () => {
    const stack = frames.get("s8") ?? [];
    expect(stack.map((f) => f.kind)).toEqual(["loop"]);
    expect(stepConditions(stack)).toEqual([]);
  });

  it("covers every step of the flow", () => {
    for (const step of walkSteps(checkout.steps)) {
      expect(frames.has(step.id)).toBe(true);
    }
  });
});

describe("validateCatalog: flow frames", () => {
  function alt(): { bad: Catalog; node: Alt } {
    const bad = clone();
    const checkout = bad.flows.find((f) => f.slug === "checkout") as Flow;
    const node = checkout.steps.find((n) => n.type === "alt") as Alt;
    return { bad, node };
  }

  it("rejects an alt with a single branch", () => {
    const { bad, node } = alt();
    node.branches = node.branches.slice(0, 1);
    expect(() => validateCatalog(bad)).toThrowError(
      /alt "alt-risk" has 1 branch\(es\); an alt states a choice/,
    );
  });

  it("rejects a branch that states no condition", () => {
    const { bad, node } = alt();
    const branch = node.branches[0];
    if (!branch) throw new Error("fixture has no branches");
    branch.title = "";
    expect(() => validateCatalog(bad)).toThrowError(
      /alt "alt-risk" has a branch with no title/,
    );
  });

  it("rejects two branches stating the same condition", () => {
    const { bad, node } = alt();
    const [first, second] = node.branches;
    if (!first || !second) throw new Error("fixture has too few branches");
    second.title = first.title;
    expect(() => validateCatalog(bad)).toThrowError(/two branches titled/);
  });

  it("rejects steps written after an alt whose every branch ends the flow", () => {
    const { bad, node } = alt();
    for (const branch of node.branches) branch.terminal = true;
    expect(() => validateCatalog(bad)).toThrowError(
      /every branch is terminal, so the 5 node\(s\) after it can never run/,
    );
  });

  it("accepts a terminal branch that other branches rejoin past", () => {
    const { bad } = alt();
    expect(() => validateCatalog(bad)).not.toThrow();
  });
});

describe("validateCatalog: building blocks", () => {
  function firstAggregate(bad: Catalog) {
    const aggregate = bad.contexts[0]?.services[0]?.aggregates[0];
    if (!aggregate) throw new Error("fixture has no aggregates");
    return aggregate;
  }

  it("rejects a root that is not one of the aggregate's entities", () => {
    const bad = clone();
    firstAggregate(bad).root = "Basket";
    expect(() => validateCatalog(bad)).toThrowError(
      /aggregate "shop.oms.order" names root "Basket", which is not one of its entities/,
    );
  });

  it("rejects a block id that disagrees with its slug", () => {
    const bad = clone();
    const vo = firstAggregate(bad).valueObjects[0];
    if (!vo) throw new Error("fixture has no value objects");
    vo.slug = "moolah";
    expect(() => validateCatalog(bad)).toThrowError(
      /must have id "shop.oms.order.moolah"/,
    );
  });

  it("rejects a block ref that is not a defs key", () => {
    const bad = clone();
    const vo = firstAggregate(bad).valueObjects[0];
    if (!vo) throw new Error("fixture has no value objects");
    vo.ref = "Doubloons";
    expect(() => validateCatalog(bad)).toThrowError(
      /value object "shop.oms.order.money" references unknown def "Doubloons"/,
    );
  });

  it("rejects a block with neither a shared type nor a shape of its own", () => {
    const bad = clone();
    const vo = firstAggregate(bad).valueObjects[0];
    if (!vo) throw new Error("fixture has no value objects");
    delete vo.ref;
    expect(() => validateCatalog(bad)).toThrowError(
      /has neither a def ref nor any fields of its own/,
    );
  });

  it("rejects two value objects sharing a slug", () => {
    const bad = clone();
    const vos = firstAggregate(bad).valueObjects;
    if (!vos[0] || !vos[1]) throw new Error("fixture too small");
    vos[1].slug = vos[0].slug;
    vos[1].id = vos[0].id;
    expect(() => validateCatalog(bad)).toThrowError(
      /value object slug "money" is not unique/,
    );
  });

  it("rejects an rpc message field pointing at no def", () => {
    const bad = clone();
    const message = bad.contexts[0]?.services[0]?.provides[0]?.messages?.[0];
    if (!message) throw new Error("fixture has no rpc messages");
    const field = message.fields[0];
    if (!field) throw new Error("fixture has no rpc message fields");
    field.ref = "Doubloons";
    expect(() => validateCatalog(bad)).toThrowError(
      /rpc message "shop.v1.Orders.PlaceOrderRequest" references unknown def "Doubloons"/,
    );
  });
});

describe("validateCatalog: decision records", () => {
  function adr(bad: Catalog, id: string): Adr {
    const found = bad.adrs.find((a) => a.id === id);
    if (!found) throw new Error(`fixture has no adr ${id}`);
    return found;
  }

  it("rejects a relates entry that resolves to nothing", () => {
    const bad = clone();
    adr(bad, "shop.oms.0007").relates.services = ["shop.nope"];
    expect(() => validateCatalog(bad)).toThrowError(
      /adr "shop.oms.0007" relates to unknown service "shop.nope"/,
    );

    const badEvent = clone();
    adr(badEvent, "org.0002").relates.events = ["shop.oms.cart.ItemAdded"];
    expect(() => validateCatalog(badEvent)).toThrowError(
      /relates to unknown event "shop.oms.cart.ItemAdded"/,
    );

    const badFlow = clone();
    adr(badFlow, "payments.0004").relates.flows = ["chekout"];
    expect(() => validateCatalog(badFlow)).toThrowError(
      /relates to unknown flow "chekout"/,
    );
  });

  it("rejects a scope that names something outside the catalog", () => {
    const bad = clone();
    adr(bad, "payments.0004").scope = { kind: "context", context: "billing" };
    expect(() => validateCatalog(bad)).toThrowError(
      /scoped to unknown context "billing"/,
    );
  });

  it("rejects a superseded record with no supersededBy", () => {
    const bad = clone();
    const superseded = adr(bad, "shop.oms.0003");
    delete superseded.supersededBy;
    adr(bad, "shop.oms.0007").supersedes = [];
    expect(() => validateCatalog(bad)).toThrowError(
      /adr "shop.oms.0003" is superseded but names no supersededBy/,
    );
  });

  it("rejects a supersession recorded on one side only", () => {
    const forward = clone();
    adr(forward, "shop.oms.0007").supersedes = [];
    expect(() => validateCatalog(forward)).toThrowError(
      /does not list it in supersedes/,
    );

    const back = clone();
    const predecessor = adr(back, "shop.oms.0003");
    predecessor.supersededBy = "org.0001";
    expect(() => validateCatalog(back)).toThrowError(
      /is not marked superseded by it/,
    );
  });

  it("rejects supersededBy on a record whose status is not superseded", () => {
    const bad = clone();
    adr(bad, "shop.oms.0003").status = "accepted";
    expect(() => validateCatalog(bad)).toThrowError(
      /its status is "accepted", not "superseded"/,
    );
  });

  it("rejects an id that disagrees with its number", () => {
    const bad = clone();
    adr(bad, "org.0002").number = 3;
    expect(() => validateCatalog(bad)).toThrowError(
      /adr "org.0002" must end with its number, "0003"/,
    );
  });
});

describe("sample data shape", () => {
  it("gives every aggregate a root entity it actually lists", () => {
    for (const aggregate of allAggregates(catalog)) {
      const root = rootEntity(aggregate);
      expect(root, `${aggregate.id} root "${aggregate.root}"`).toBeDefined();
      expect(aggregate.entities.length).toBeGreaterThan(0);
    }
  });

  it("names Money in more than one aggregate, through the same shared def", () => {
    const money = allAggregates(catalog)
      .flatMap((a) => a.valueObjects)
      .filter((v) => v.ref === "Money");
    expect(money.length).toBeGreaterThan(1);
    // Same def, so the same fields, wherever it is named.
    for (const vo of money) {
      expect(blockFields(catalog, vo).map((f) => f.name)).toEqual([
        "amountMinor",
        "currency",
      ]);
    }
  });

  it("resolves a block's shape from its def or from its own fields", () => {
    const index = buildIndex(catalog);
    const shared = index.blockById.get("shop.oms.order.money");
    const inline = index.blockById.get("shop.pricing.quote.quoted-line");
    if (!shared || !inline) throw new Error("fixture is missing blocks");
    expect(shared.kind).toBe("vo");
    expect(blockFields(catalog, shared.block)).toEqual(
      catalog.defs["Money"]?.fields,
    );
    expect(inline.block.ref).toBeUndefined();
    expect(blockFields(catalog, inline.block).map((f) => f.name)).toContain(
      "discountMinor",
    );
  });

  it("indexes blocks by the shared def they name", () => {
    const index = buildIndex(catalog);
    expect(index.blocksByDef.get("Money")?.length).toBeGreaterThan(1);
    expect(index.blocksByDef.get("Money")).toContain("shop.oms.order.money");
    expect(index.blocksByDef.has("Doubloons")).toBe(false);
  });

  it("has three contexts, four services and one empty aggregate", () => {
    expect(catalog.contexts.map((c) => c.id)).toEqual([
      "shop",
      "payments",
      "delivery",
    ]);
    const services = catalog.contexts.flatMap((c) => c.services);
    expect(services.map((s) => s.id)).toEqual([
      "shop.oms",
      "shop.pricing",
      "payments.ledger",
      "delivery.core",
    ]);
    const empty = services
      .flatMap((s) => s.aggregates)
      .filter((a) => a.events.length === 0)
      .map((a) => a.id);
    expect(empty).toEqual(["shop.pricing.price-list"]);
  });

  it("has around twelve events and one with two versions adding a field", () => {
    const events = allEvents(catalog);
    expect(events.length).toBeGreaterThanOrEqual(12);
    const twoVersions = events.filter((e) => e.versions.length === 2);
    expect(twoVersions).toHaveLength(1);
    const event = twoVersions[0];
    if (!event) throw new Error("no versioned event");
    const [v1, v2] = event.versions;
    if (!v1 || !v2) throw new Error("bad versions");
    expect(v2.fields.length).toBe(v1.fields.length + 1);
  });

  it("has exactly one unresolved RpcCall", () => {
    const unresolved = catalog.contexts
      .flatMap((c) => c.services)
      .flatMap((s) => s.consumes)
      .filter((r) => r.status === "unresolved");
    expect(unresolved.map((r) => r.id)).toEqual(["fraud.v2.Scoring/Score"]);
  });

  it("covers all four provenance shapes", () => {
    const flows = catalog.flows;
    expect(flows.map((f) => f.slug)).toEqual([
      "order-accepted",
      "checkout",
      "refund-requested",
      "shipment-tracking",
    ]);
    const a = flows[0];
    const c = flows[2];
    const d = flows[3];
    if (!a || !c || !d) throw new Error("missing flows");
    expect(flowCoverage(a)).toEqual({
      verified: 3,
      declared: 0,
      unresolved: 0,
      total: 3,
    });
    expect(walkSteps(c.steps).every((s) => s.status === "declared")).toBe(true);
    expect(c.provenance).toBe("authored");
    expect(d.provenance).toBe("derived-from-otel");
    expect(d.verifiedAt).toBeTruthy();
  });

  it("gives checkout mixed statuses with s6 unresolved", () => {
    const checkout = catalog.flows.find((f) => f.slug === "checkout");
    if (!checkout) throw new Error("no checkout flow");
    const cov = flowCoverage(checkout);
    expect(cov.verified).toBeGreaterThan(0);
    expect(cov.declared).toBeGreaterThan(0);
    expect(cov.unresolved).toBe(1);
    const s6 = walkSteps(checkout.steps).find((s) => s.id === "s6");
    expect(s6?.status).toBe("unresolved");
    expect(s6?.note).toBeTruthy();
  });

  it("has five decisions, one of them superseded by another", () => {
    expect(catalog.adrs.map((a) => a.id).sort()).toEqual([
      "org.0001",
      "org.0002",
      "payments.0004",
      "shop.oms.0003",
      "shop.oms.0007",
    ]);
    const superseded = catalog.adrs.filter((a) => a.status === "superseded");
    expect(superseded.map((a) => a.id)).toEqual(["shop.oms.0003"]);
    expect(superseded[0]?.supersededBy).toBe("shop.oms.0007");
    // The superseded record keeps its own body, wrong diagram included.
    expect(superseded[0]?.body).toContain("QueryWorkflow(cart_id");
  });

  it("indexes decisions by the events they name, newest first", () => {
    const index = buildIndex(catalog);
    expect(
      index.adrsByEvent
        .get("payments.ledger.payment.PaymentCaptured")
        ?.map((a) => a.id),
    ).toEqual(["payments.0004"]);
    expect(
      index.adrBySlug.get("org-0001-client-protos-in-consumer-infrastructure")
        ?.id,
    ).toBe("org.0001");
  });

  it("indexes flows by event", () => {
    const index = buildIndex(catalog);
    expect(index.flowsByEvent.get("shop.oms.order.OrderPlaced")).toEqual([
      "order-accepted",
      "checkout",
    ]);
    expect(index.rpcProviderByMethod.get("shop.v1.Pricing/GetQuote")?.id).toBe(
      "shop.pricing",
    );
    expect(index.rpcProviderByMethod.has("fraud.v2.Scoring/Score")).toBe(false);
  });
});
