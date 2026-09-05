import { describe, expect, it } from "vitest";
import { rawCatalog as raw } from "./test-catalog";
import {
  CatalogError,
  allAggregates,
  allEvents,
  blockFields,
  buildIndex,
  rootEntity,
  stepConditions,
  stepFrames,
  validateCatalog,
  walkSteps,
} from "./catalog";
import type { Adr, Alt, Catalog, Classification, Flow } from "./catalog";

const catalog = raw as unknown as Catalog;

function clone(): Catalog {
  return JSON.parse(JSON.stringify(catalog)) as Catalog;
}

describe("validateCatalog", () => {
  it("accepts the shipped catalog", () => {
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it("rejects an operation exposed by a method no interface declares", () => {
    const bad = clone();
    const aggregate = bad.contexts[0]?.services[0]?.aggregates[0];
    if (!aggregate) throw new Error("no aggregate to hang the operation on");
    const operation = aggregate.operations[0];
    if (!operation) throw new Error("no operation");
    operation.exposedBy = ["notAMethod"];

    expect(() => validateCatalog(bad)).toThrow(/exposed by "notAMethod"/);
  });

  // The pairing is the whole point of the field, so the shipped catalog is
  // held to it rather than only the hand-made counterexample above.
  it("accepts an operation exposed by a method its service really declares", () => {
    const good = clone();
    const service = good.contexts[0]?.services[0];
    const method = service?.provides[0]?.methods[0];
    const operation = service?.aggregates[0]?.operations[0];
    if (!service || !method || !operation) throw new Error("nothing to pair");
    operation.exposedBy = [method.name];

    expect(() => validateCatalog(good)).not.toThrow();
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

  it("rejects a context whose slug is not its id", () => {
    const bad = clone();
    const context = bad.contexts[0];
    if (!context) throw new Error("fixture has no contexts");
    context.slug = "the-shop";
    expect(() => validateCatalog(bad)).toThrowError(CatalogError);
    expect(() => validateCatalog(bad)).toThrowError(
      /context "shop" has slug "the-shop".*must equal its id/s,
    );
  });

  it("rejects a classification outside the three it may take", () => {
    const bad = clone();
    const context = bad.contexts[0];
    if (!context) throw new Error("fixture has no contexts");
    context.classification = "strategic" as Classification;
    expect(() => validateCatalog(bad)).toThrowError(
      /classification "strategic"; expected one of core, supporting, generic/,
    );
  });

  it("accepts a context that states no classification at all", () => {
    const bad = clone();
    const context = bad.contexts[0];
    if (!context) throw new Error("fixture has no contexts");
    delete context.classification;
    expect(() => validateCatalog(bad)).not.toThrow();
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
  const stacks = [...frames.values()];

  it("covers every step of the flow", () => {
    for (const step of walkSteps(checkout.steps)) {
      expect(frames.has(step.id), step.id).toBe(true);
    }
  });

  it("gives a step outside every frame an empty stack", () => {
    expect(stacks.some((stack) => stack.length === 0)).toBe(true);
  });

  it("stacks the frames outermost first, matching the tree's own nesting", () => {
    // A stack is a path down the tree, so every prefix of it must itself be a
    // stack some other step has - otherwise a frame was skipped or reordered.
    const seen = new Set(
      stacks.map((stack) => stack.map((f) => f.id).join(">")),
    );
    for (const stack of stacks) {
      for (let i = 1; i < stack.length; i += 1) {
        const prefix = stack
          .slice(0, i)
          .map((f) => f.id)
          .join(">");
        expect(
          [...seen].some(
            (key) => key === prefix || key.startsWith(`${prefix}>`),
          ),
          prefix,
        ).toBe(true);
      }
    }
  });

  it("names the branch on an alt frame and the title on a loop or parallel", () => {
    for (const frame of stacks.flat()) {
      if (frame.kind === "alt") expect(frame.branch, frame.id).toBeTruthy();
      if (frame.kind === "loop") expect(frame.title, frame.id).toBeTruthy();
      if (frame.kind === "parallel")
        expect(frame.branch, frame.id).toBeTruthy();
    }
  });

  it("carries the terminal flag onto every step of the branch that ends", () => {
    const terminal = stacks.flat().filter((f) => f.terminal);
    expect(terminal.length).toBeGreaterThan(0);
    for (const frame of terminal) expect(frame.kind).toBe("alt");
  });

  it("reports a loop as a frame but never as a condition", () => {
    const withLoop = stacks.find((stack) =>
      stack.some((f) => f.kind === "loop"),
    );
    if (!withLoop) throw new Error("fixture has no loop");
    expect(stepConditions(withLoop).every((f) => f.kind === "alt")).toBe(true);
    expect(stepConditions(withLoop).length).toBeLessThan(withLoop.length);
  });
});

describe("validateCatalog: flow frames", () => {
  /** The first alt of the checkout flow, in a throwaway copy of the catalog. */
  function alt(): { bad: Catalog; node: Alt } {
    const bad = clone();
    const checkout = bad.flows.find((f) => f.slug === "checkout") as Flow;
    const node = checkout.steps.find((n) => n.type === "alt") as Alt;
    if (!node) throw new Error("fixture has no top-level alt in checkout");
    return { bad, node };
  }

  it("accepts the shipped catalog, terminal branches and all", () => {
    expect(() => validateCatalog(clone())).not.toThrow();
  });

  it("rejects an alt with a single branch", () => {
    const { bad, node } = alt();
    node.branches = node.branches.slice(0, 1);
    expect(() => validateCatalog(bad)).toThrowError(
      /has 1 branch\(es\); an alt states a choice/,
    );
  });

  it("rejects a branch that states no condition", () => {
    const { bad, node } = alt();
    const branch = node.branches[0];
    if (!branch) throw new Error("fixture has no branches");
    branch.title = "";
    expect(() => validateCatalog(bad)).toThrowError(
      /has a branch with no title/,
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
      /every branch is terminal, so the \d+ node\(s\) after it can never run/,
    );
  });

  it("rejects a loop that does not say what it repeats until", () => {
    const bad = clone();
    const flow = bad.flows.find((f) => f.slug === "checkout") as Flow;
    const loop = flow.steps.find((n) => n.type === "loop");
    if (!loop || loop.type !== "loop") throw new Error("fixture has no loop");
    loop.title = "";
    expect(() => validateCatalog(bad)).toThrowError(/has no title/);
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

  it("accepts a lifecycle over its own states and events, and derives nothing else", () => {
    const ok = clone();
    const agg = firstAggregate(ok);
    agg.lifecycle = {
      states: ["open", "placed"],
      transitions: [{ from: "open", to: "placed", on: "place", emits: agg.events[0]!.id }],
    };
    expect(() => validateCatalog(ok)).not.toThrow();
  });

  it("rejects a transition into a state the lifecycle does not list", () => {
    const bad = clone();
    firstAggregate(bad).lifecycle = {
      states: ["open"],
      transitions: [{ from: "open", to: "gone", on: "vanish" }],
    };
    expect(() => validateCatalog(bad)).toThrowError(/"gone" is not one of its states/);
  });

  it("rejects a transition emitting an event of another aggregate", () => {
    const bad = clone();
    firstAggregate(bad).lifecycle = {
      states: ["open", "placed"],
      transitions: [{ from: "open", to: "placed", on: "place", emits: "shop.cart.basket.BasketCreated" }],
    };
    expect(() => validateCatalog(bad)).toThrowError(/which is not one of its events/);
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

  it("has four contexts, six services and one aggregate that publishes nothing", () => {
    // The hand-written estate first, in its own order; then what the
    // examples publish, in path order. shop.cart sits under examples/ and so
    // joins shop after the two services data/ wrote.
    expect(catalog.contexts.map((c) => c.id)).toEqual([
      "shop",
      "payments",
      "delivery",
      "auth",
    ]);
    expect(catalog.contexts.map((c) => c.classification)).toEqual([
      "core",
      "core",
      "supporting",
      "core",
    ]);
    const services = catalog.contexts.flatMap((c) => c.services);
    expect(services.map((s) => s.id)).toEqual([
      "shop.oms",
      "shop.pricing",
      "shop.cart",
      "payments.ledger",
      "delivery.core",
      "auth.auth",
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

  it("leaves two peers unresolved by hand, and one more read out of auth", () => {
    const unresolved = catalog.contexts
      .flatMap((c) => c.services)
      .flatMap((s) => s.consumes)
      .filter((r) => r.status === "unresolved");
    expect(unresolved.map((r) => r.id)).toEqual([
      "fraud.v2.Scoring/Score",
      "psp.v2.Charges/Create",
      "psp.v2.Charges/Capture",
      "psp.v2.Charges/Refund",
      "psp.v2.Charges/Void",
      "risk.v1.RiskService/Assess",
    ]);
    // The hand-written two are unresolved for the same reason and each says
    // so on the record; the one the extractor read off auth has only the
    // package it could not place.
    const byHand = unresolved.filter((r) => !r.id.startsWith("risk."));
    expect(new Set(byHand.map((r) => r.peer))).toEqual(
      new Set(["fraud-scoring", "psp-gateway"]),
    );
    for (const call of byHand) expect(call.note, call.id).toBeTruthy();
  });

  it("gives every flow an owner, and covers both ends of step status", () => {
    const flows = catalog.flows;
    // In the order their files sort, which is the order the extract step
    // reads data/flows/*.flow.md in; then each example's flows, in the order
    // its extractor and its recording wrote them.
    expect(flows.map((f) => f.slug)).toEqual([
      "checkout",
      "gateway-webhook",
      "order-accepted",
      "order-cancelled",
      "quote-expired-on-checkout",
      "refund-requested",
      "shipment-tracking",
      "auth-change-password",
      "auth-get-user",
      "auth-login",
      "auth-logout",
      "auth-register-user",
      "auth-validate-session",
      "auth-revoke-sessions-on-password-change",
      "cart-add-item",
      "cart-checkout",
      "cart-create-basket",
      "cart-get-basket",
      "cart-merge-baskets",
      "cart-remove-item",
    ]);
    // Nothing in the tree has to guess where a flow belongs.
    for (const flow of flows) expect(flow.owner, flow.slug).toBeTruthy();

    const a = flows.find((f) => f.slug === "order-accepted");
    const c = flows.find((f) => f.slug === "refund-requested");
    if (!a || !c) throw new Error("missing flows");
    // One flow whose every hop lands on something the catalog has, and one
    // with a hop that does not: both ends of the range are in the fixture.
    expect(walkSteps(a.steps).some((s) => s.status === "unresolved")).toBe(
      false,
    );
    expect(walkSteps(c.steps).every((s) => s.status === "declared")).toBe(true);
  });

  it("gives checkout mixed statuses, and a note on every unresolved hop", () => {
    const checkout = catalog.flows.find((f) => f.slug === "checkout");
    if (!checkout) throw new Error("no checkout flow");
    const steps = walkSteps(checkout.steps);
    const statuses = steps.map((s) => s.status);
    expect(statuses).toContain("verified");
    expect(statuses).toContain("declared");
    // The risk scorer and the two gateway hops: three peers outside the model.
    const unresolved = steps.filter((s) => s.status === "unresolved");
    expect(unresolved.map((s) => s.id)).toEqual(["s7", "s22", "s32"]);
    // An unresolved step that does not say why is just a red mark.
    expect(unresolved.filter((s) => s.note).length).toBeGreaterThan(0);
    expect(steps.find((s) => s.id === "s7")?.note).toBeTruthy();
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
      "checkout",
      "order-accepted",
    ]);
    expect(index.rpcProviderByMethod.get("shop.v1.Pricing/GetQuote")?.id).toBe(
      "shop.pricing",
    );
    expect(index.rpcProviderByMethod.has("fraud.v2.Scoring/Score")).toBe(false);
  });
});

describe("glossary terms", () => {
  function terms(bad: Catalog) {
    const list = bad.terms;
    if (!list || list.length === 0) throw new Error("fixture has no terms");
    return list;
  }

  it("indexes a term by id and groups a context's vocabulary", () => {
    const index = buildIndex(catalog);

    expect(index.termById.get("auth.session")?.name).toBe("Session");
    expect(index.termsByContext.get("auth")?.length).toBe(
      (catalog.terms ?? []).filter((t) => t.context === "auth").length,
    );
    // The same word in two contexts is two terms, and neither shadows the
    // other: the id carries the boundary the meaning belongs to.
    expect(index.termById.get("auth.bus")?.definition).not.toBe(
      index.termById.get("shop.bus")?.definition,
    );
  });

  it("carries the glossary's own paragraph, whole", () => {
    const session = buildIndex(catalog).termById.get("auth.session");

    expect(session?.definition).toMatch(/^Proof that a user logged in/);
  });

  // The mistake this catches is one line of the manifest: a step that does not
  // say which context the glossary belongs to falls back to the directory, and
  // every term it writes then belongs to a context nothing else declares.
  it("rejects a term whose context the catalog does not declare", () => {
    const bad = clone();
    const term = terms(bad)[0]!;
    term.context = "oms";
    term.id = `oms.${term.slug}`;

    expect(() => validateCatalog(bad)).toThrowError(
      /belongs to context "oms", which the catalog does not declare/,
    );
  });

  it("rejects an id that is not its context and slug", () => {
    const bad = clone();
    terms(bad)[0]!.id = "auth.something-else";

    expect(() => validateCatalog(bad)).toThrowError(/must have id/);
  });

  it("rejects a term that says nothing about what it is", () => {
    const bad = clone();
    terms(bad)[0]!.definition = "";

    expect(() => validateCatalog(bad)).toThrowError(/says nothing about what it is/);
  });

  it("indexes a term whose definition is one short sentence", () => {
    const ok = clone();
    terms(ok)[0]!.definition = "One sentence.";

    expect(() => validateCatalog(ok)).not.toThrow();
  });
});

describe("validateCatalog: interfaces and modules", () => {
  it("rejects two methods of one interface sharing a name", () => {
    const bad = clone();
    const provided = bad.contexts[0]?.services[0]?.provides[0];
    if (!provided) throw new Error("nothing to break");
    provided.methods = [{ name: "Same" }, { name: "Same" }];

    // `exposedBy` names a method by name alone and `rpcProviderByMethod` is
    // keyed by it, so a duplicate makes one of the two unreachable.
    expect(() => validateCatalog(bad)).toThrow(CatalogError);
  });

  it("rejects a method that streams in a way nothing means", () => {
    const bad = clone();
    const provided = bad.contexts[0]?.services[0]?.provides[0];
    const method = provided?.methods[0];
    if (!method) throw new Error("nothing to break");
    method.streaming = "sideways" as never;

    expect(() => validateCatalog(bad)).toThrow(/expected one of/);
  });

  it("accepts a method that carries shapes and streams", () => {
    const good = clone();
    const method = good.contexts[0]?.services[0]?.provides[0]?.methods[0];
    if (!method) throw new Error("nothing to change");
    method.request = "PlaceOrderRequest";
    method.response = "PlaceOrderResponse";
    method.streaming = "server";
    method.deprecated = true;

    expect(() => validateCatalog(good)).not.toThrow();
  });

  // The shipped catalog publishes, so "no modules" has to be made: nothing may
  // name one either, or the validator is right to refuse.
  it("accepts a catalog with no modules at all", () => {
    const none = clone();
    delete none.modules;
    for (const context of none.contexts) {
      for (const service of context.services) {
        delete service.modules;
        for (const provided of service.provides) delete provided.module;
      }
    }

    expect(() => validateCatalog(none)).not.toThrow();
  });

  it("rejects a service naming a module that is not in the catalog", () => {
    const bad = clone();
    const service = bad.contexts[0]?.services[0];
    if (!service) throw new Error("nothing to break");
    service.modules = ["buf.build/acme/nowhere"];

    expect(() => validateCatalog(bad)).toThrow(/not in this catalog/);
  });

  it("rejects an interface declaring itself part of a module nobody declared", () => {
    const bad = clone();
    const provided = bad.contexts[0]?.services[0]?.provides[0];
    if (!provided) throw new Error("nothing to break");
    provided.module = "buf.build/acme/nowhere";

    expect(() => validateCatalog(bad)).toThrow(/not in this catalog/);
  });

  it("rejects a module owned by something that is not a service", () => {
    const bad = withModule(clone());
    const module = bad.modules?.[0];
    if (!module) throw new Error("nothing to break");
    module.owner = "shop.nobody";

    expect(() => validateCatalog(bad)).toThrow(/not a service/);
  });

  // A module published by a team, or by a repository outside the estate, is
  // the ordinary case - not a defect.
  it("accepts a module nobody in the catalog owns", () => {
    const good = withModule(clone());
    delete good.modules?.[0]?.owner;

    expect(() => validateCatalog(good)).not.toThrow();
  });

  it("rejects two modules sharing a slug, which is what the URL uses", () => {
    const bad = withModule(clone());
    bad.modules?.push({
      ...bad.modules[0]!,
      id: "buf.build/other/shop",
      name: "other/shop",
    });

    expect(() => validateCatalog(bad)).toThrow(/slug/);
  });

  // A module's deps come from its own lock and routinely name modules this
  // estate never vendored - the same kind of fact as a call to a peer outside
  // the catalog. Requiring them to resolve would mean a module could only be
  // recorded once everything it depends on had been vendored too.
  it("accepts a module depending on one the estate never vendored", () => {
    const good = withModule(clone());
    if (!good.modules?.[0]) throw new Error("nothing to change");
    good.modules[0].deps = ["buf.build/acme/never-vendored"];

    expect(() => validateCatalog(good)).not.toThrow();
  });

  it("indexes a module by id and by slug, and finds who uses it", () => {
    const withOne = withModule(clone());
    const service = withOne.contexts[0]?.services[0];
    const provided = service?.provides[0];
    if (!service || !provided) throw new Error("nothing to link");
    provided.module = "buf.build/acme/shop";

    const index = buildIndex(validateCatalog(withOne));

    expect(index.moduleById.get("buf.build/acme/shop")?.slug).toBe("acme-shop");
    expect(index.moduleBySlug.get("acme-shop")?.id).toBe("buf.build/acme/shop");
    expect(
      index.interfacesByModule.get("buf.build/acme/shop")?.[0]?.provided.id,
    ).toBe(provided.id);
    expect(
      index.servicesUsingModule.get("buf.build/acme/shop")?.map((s) => s.id),
    ).toEqual([service.id]);
  });
});

/**
 * The shipped catalog plus one module, owned by its first service. Added
 * beside what the estate has published, not in its place: a service already
 * names its module, and taking that module away breaks the catalog before the
 * test gets to say what it meant to.
 */
function withModule(catalog: Catalog): Catalog {
  const owner = catalog.contexts[0]?.services[0]?.id;
  catalog.modules = [
    ...(catalog.modules ?? []),
    {
      id: "buf.build/acme/shop",
      slug: "acme-shop",
      name: "acme/shop",
      registry: "buf.build",
      owner,
      packages: ["shop.v1"],
      files: ["shop/v1/orders.proto"],
      source: "proto",
    },
  ];

  return catalog;
}

describe("validateCatalog: repo pins", () => {
  it("accepts a pin for a repository no service claims to live in", () => {
    // A repository fetched for its protos before anything reads its code is a
    // normal intermediate state: the pin is simply never looked up. Failing
    // here would refuse to render an estate mid-migration.
    const good = clone();
    good.repos = [{ repo: "github.com/acme/pay", commit: "c1d2e3f" }];

    expect(() => validateCatalog(good)).not.toThrow();
  });

  it("rejects a pin with no commit", () => {
    const bad = clone();
    bad.repos = [{ repo: "github.com/acme/shop", commit: "" }];

    expect(() => validateCatalog(bad)).toThrow(/pinned to nothing/);
  });

  it("rejects one repository pinned twice in one catalog", () => {
    const bad = clone();
    bad.repos = [
      { repo: "github.com/acme/shop", commit: "c1d2e3f" },
      { repo: "github.com/acme/shop", commit: "c1d2e3f" },
    ];

    expect(() => validateCatalog(bad)).toThrow(/pinned twice/);
  });
});

describe("validateCatalog: channels", () => {
  function speaking(): Catalog {
    const good = clone();
    const service = good.contexts[0]?.services[0];
    if (!service) throw new Error("nothing to change");
    service.channels = [
      {
        address: "shop.cart.basket",
        source: "asyncapi.yaml",
        messages: [
          { name: "cart.BasketCreated", direction: "send" },
          { name: "auth.SessionEnded", direction: "receive" },
        ],
      },
    ];

    return good;
  }

  it("accepts a service that declares what it says on the bus", () => {
    expect(() => validateCatalog(speaking())).not.toThrow();
  });

  // A service with no document is the normal case, and it is not a service
  // that speaks to nobody.
  it("accepts a service with no channels at all", () => {
    const none = clone();
    for (const context of none.contexts) {
      for (const service of context.services) delete service.channels;
    }

    expect(() => validateCatalog(none)).not.toThrow();
  });

  it("rejects a channel with no address", () => {
    const bad = speaking();
    const channel = bad.contexts[0]?.services[0]?.channels?.[0];
    if (!channel) throw new Error("nothing to break");
    channel.address = "";

    expect(() => validateCatalog(bad)).toThrow(/no address/);
  });

  // One channel says both directions, so a second entry for the same address
  // is two answers to one question.
  it("rejects one address declared twice", () => {
    const bad = speaking();
    const channels = bad.contexts[0]?.services[0]?.channels;
    if (!channels?.[0]) throw new Error("nothing to break");
    channels.push({ ...channels[0], messages: [] });

    expect(() => validateCatalog(bad)).toThrow(/twice/);
  });

  // The name is what an event's wire is compared against, and a blank one
  // matches everything.
  it("rejects a message with no name", () => {
    const bad = speaking();
    const message = bad.contexts[0]?.services[0]?.channels?.[0]?.messages[0];
    if (!message) throw new Error("nothing to break");
    message.name = "";

    expect(() => validateCatalog(bad)).toThrow(/no name/);
  });

  it("rejects a direction that is neither send nor receive", () => {
    const bad = speaking();
    const message = bad.contexts[0]?.services[0]?.channels?.[0]?.messages[0];
    if (!message) throw new Error("nothing to break");
    message.direction = "publish" as never;

    expect(() => validateCatalog(bad)).toThrow(/neither send nor receive/);
  });
});
