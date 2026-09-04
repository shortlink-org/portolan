import { describe, expect, it } from "vitest";
import type { BoundedContext, Catalog } from "./catalog";
import { mergeCatalogs } from "./merge";
import type { CatalogSource } from "./merge";

function source(path: string, catalog: Partial<Catalog>): CatalogSource {
  return {
    path,
    catalog: {
      generatedAt: "2026-01-01T00:00:00Z",
      commit: "aaa1111",
      contexts: [],
      defs: {},
      flows: [],
      adrs: [],
      ...catalog,
    },
  };
}

function context(
  id: string,
  services: string[],
  overrides: Partial<BoundedContext> = {},
): BoundedContext {
  return {
    id,
    slug: id,
    name: id,
    summary: "",
    services: services.map((serviceId) => ({
      id: serviceId,
      slug: serviceId.split(".")[1] ?? serviceId,
      name: serviceId,
      repo: "",
      path: "",
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
    })),
    ...overrides,
  };
}

describe("mergeCatalogs", () => {
  it("puts services from two sources into the context they share", () => {
    const merged = mergeCatalogs([
      source("a.json", { contexts: [context("shop", ["shop.oms"])] }),
      source("b.json", { contexts: [context("shop", ["shop.pricing"])] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.catalog.contexts).toHaveLength(1);
    expect(merged.catalog.contexts[0]?.services.map((s) => s.id)).toEqual([
      "shop.oms",
      "shop.pricing",
    ]);
  });

  // The set of sources comes from a glob, and a glob's order is not a fact
  // about the estate. Two runs that disagree would make every generated file
  // churn for no reason.
  it("does not depend on the order the sources arrive in", () => {
    const a = source("a.json", { contexts: [context("shop", ["shop.oms"])] });
    const b = source("b.json", {
      contexts: [context("shop", ["shop.pricing"])],
    });

    expect(JSON.stringify(mergeCatalogs([a, b]).catalog)).toEqual(
      JSON.stringify(mergeCatalogs([b, a]).catalog),
    );
  });

  // A fragment that knows only one aspect leaves the rest empty, and sorts
  // wherever its filename puts it. An empty value must never win.
  it("lets a later source fill in what an earlier one left empty", () => {
    const bare = context("auth", ["auth.auth"], { name: "", summary: "" });
    bare.services = bare.services.map((s) => ({ ...s, name: "", repo: "" }));

    const full = context("auth", ["auth.auth"], { name: "Authentication" });
    full.services = full.services.map((s) => ({
      ...s,
      name: "Authentication & Sessions",
      repo: "github.com/example/auth",
    }));

    const merged = mergeCatalogs([
      source("a-api.json", { contexts: [bare] }),
      source("b-domain.json", { contexts: [full] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.catalog.contexts[0]?.name).toBe("Authentication");
    expect(merged.catalog.contexts[0]?.services[0]?.name).toBe(
      "Authentication & Sessions",
    );
  });

  it("records two sources disagreeing about a context's name, and keeps the first", () => {
    const merged = mergeCatalogs([
      source("a.json", { contexts: [context("shop", [], { name: "Shop" })] }),
      source("b.json", {
        contexts: [context("shop", [], { name: "Storefront" })],
      }),
    ]);

    expect(merged.catalog.contexts[0]?.name).toBe("Shop");
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.path).toBe("b.json");
    expect(merged.conflicts[0]?.message).toContain("Storefront");
  });

  // The reason each aspect of a service gets its own extractor: one source
  // knows the aggregates, another knows what the service answers over HTTP, and
  // neither has to know the other exists.
  it("merges one service described by two sources", () => {
    const domain = context("auth", ["auth.auth"]);
    domain.services = domain.services.map((s) => ({
      ...s,
      aggregates: [
        {
          id: "auth.auth.user",
          slug: "user",
          name: "User",
          readme: "",
          root: "User",
          entities: [],
          valueObjects: [],
          operations: [],
          events: [],
        },
      ],
    }));

    const api = context("auth", ["auth.auth"]);
    api.services = api.services.map((s) => ({
      ...s,
      provides: [
        {
          id: "auth.v1.Users",
          methods: [{ name: "registerUser" }],
          source: "openapi.yaml",
        },
      ],
    }));

    const merged = mergeCatalogs([
      source("a-domain.json", { contexts: [domain] }),
      source("b-api.json", { contexts: [api] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.catalog.contexts[0]?.services).toHaveLength(1);

    const service = merged.catalog.contexts[0]?.services[0];
    expect(service?.aggregates.map((a) => a.id)).toEqual(["auth.auth.user"]);
    expect(service?.provides.map((p) => p.id)).toEqual(["auth.v1.Users"]);
  });

  it("lets a second source add an event, and a consumer, to an aggregate it did not declare", () => {
    const aggregate = (events: Catalog["contexts"][0]["services"][0]["aggregates"][0]["events"]) => ({
      id: "shop.oms.order",
      slug: "order",
      name: "Order",
      readme: "",
      root: "Order",
      entities: [],
      valueObjects: [],
      operations: [],
      events,
    });
    const event = (name: string, consumers: { service: string; status: "declared" | "verified"; note?: string }[]) => ({
      id: `shop.oms.order.${name}`,
      slug: name.toLowerCase(),
      name,
      versions: [{ version: "v1", doc: "", source: "x", fields: [] }],
      consumers,
    });

    const producer = context("shop", ["shop.oms"]);
    producer.services[0]!.aggregates = [
      aggregate([event("OrderPlaced", [{ service: "payments.ledger", status: "declared", note: "first" }])]),
    ];
    const overlay = context("shop", ["shop.oms"]);
    overlay.services[0]!.aggregates = [
      aggregate([
        event("OrderPlaced", [
          { service: "payments.ledger", status: "verified", note: "second" },
          { service: "delivery.core", status: "declared" },
        ]),
        event("OrderCancelled", []),
      ]),
    ];

    const before = JSON.stringify([producer, overlay]);
    const merged = mergeCatalogs([
      source("a.json", { contexts: [producer] }),
      source("b.json", { contexts: [overlay] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    const events = merged.catalog.contexts[0]?.services[0]?.aggregates[0]?.events;
    expect(events?.map((e) => e.id)).toEqual([
      "shop.oms.order.OrderPlaced",
      "shop.oms.order.OrderCancelled",
    ]);
    // The second source has seen the ledger consume it, and that is the one
    // thing a later source may say about an edge somebody else declared.
    expect(events?.[0]?.consumers).toEqual([
      { service: "payments.ledger", status: "verified", note: "first" },
      { service: "delivery.core", status: "declared" },
    ]);
    // The union never writes into a source.
    expect(JSON.stringify([producer, overlay])).toBe(before);
  });

  it("reports two sources disagreeing about a service's repo", () => {
    const a = context("auth", ["auth.auth"]);
    a.services = a.services.map((s) => ({ ...s, repo: "github.com/one" }));
    const b = context("auth", ["auth.auth"]);
    b.services = b.services.map((s) => ({ ...s, repo: "github.com/two" }));

    const merged = mergeCatalogs([
      source("a.json", { contexts: [a] }),
      source("b.json", { contexts: [b] }),
    ]);

    expect(merged.catalog.contexts[0]?.services[0]?.repo).toBe(
      "github.com/one",
    );
    expect(merged.conflicts[0]?.message).toContain("different repo");
  });

  it("accepts a shared type defined identically twice", () => {
    const money = { fields: [{ name: "amount", type: "int64", doc: "" }] };
    const merged = mergeCatalogs([
      source("a.json", { defs: { Money: money } }),
      source("b.json", { defs: { Money: money } }),
    ]);

    expect(merged.conflicts).toEqual([]);
  });

  // `ref` is a bare key into one namespace, so two sources meaning different
  // things by "Money" is a real problem rather than a naming accident.
  it("reports a shared type defined differently in two sources", () => {
    const merged = mergeCatalogs([
      source("a.json", {
        defs: {
          Money: { fields: [{ name: "amount", type: "int64", doc: "" }] },
        },
      }),
      source("b.json", {
        defs: {
          Money: { fields: [{ name: "amount", type: "string", doc: "" }] },
        },
      }),
    ]);

    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.where).toBe("defs.Money");
    expect(merged.catalog.defs.Money?.fields[0]?.type).toBe("int64");
  });

  it("keeps one flow when two sources declare the same id, and says so when they disagree", () => {
    const flow = {
      id: "flow.checkout",
      slug: "checkout",
      name: "Checkout",
      summary: "",
      owner: "shop",
      participants: [],
      steps: [],
    };
    const hop = {
      type: "step" as const,
      id: "s1",
      from: "a",
      to: "b",
      kind: "call" as const,
      label: "x",
      status: "declared" as const,
    };

    const merged = mergeCatalogs([
      source("a.json", { flows: [flow] }),
      source("b.json", { flows: [{ ...flow, name: "Checkout again", steps: [hop] }] }),
    ]);

    expect(merged.catalog.flows).toHaveLength(1);
    expect(merged.catalog.flows[0]?.name).toBe("Checkout");
    expect(merged.catalog.flows[0]?.steps).toEqual([]);
    expect(merged.conflicts[0]?.message).toContain(
      "already declared in a.json",
    );
  });

  // A merged catalog is exactly as fresh as its stalest part, and the parts
  // keep their own stamps so anything that wants to be precise still can be.
  it("stamps the merge with the oldest source and keeps each source's own", () => {
    const merged = mergeCatalogs([
      source("a.json", { generatedAt: "2026-03-01T00:00:00Z", commit: "aaa" }),
      source("b.json", { generatedAt: "2026-01-01T00:00:00Z", commit: "bbb" }),
    ]);

    expect(merged.catalog.generatedAt).toBe("2026-01-01T00:00:00Z");
    expect(merged.catalog.commit).toBe("2 sources");
    expect(merged.sources).toEqual([
      { path: "a.json", generatedAt: "2026-03-01T00:00:00Z", commit: "aaa" },
      { path: "b.json", generatedAt: "2026-01-01T00:00:00Z", commit: "bbb" },
    ]);
  });

  it("keeps a single commit when every source agrees", () => {
    const merged = mergeCatalogs([
      source("a.json", { commit: "same" }),
      source("b.json", { commit: "same" }),
    ]);

    expect(merged.catalog.commit).toBe("same");
  });
});

describe("mergeCatalogs: schema modules", () => {
  const shop = () => ({
    id: "buf.build/acme/shop",
    slug: "acme-shop",
    name: "acme/shop",
    registry: "buf.build",
    packages: ["shop.v1"],
    files: ["shop/v1/orders.proto"],
    source: "proto",
  });

  // THE TEST THAT JUSTIFIES THE ID SCHEME.
  //
  // The producer and each consumer describe the same module from different
  // repositories, and neither knows what the other calls it. Only a
  // registry-global id makes them one entry; an id derived from an owner would
  // grow one module per reader.
  it("unions a module described by a producer and by a consumer into one", () => {
    const merged = mergeCatalogs([
      source("a-producer.json", {
        modules: [{ ...shop(), owner: "shop.oms" }],
      }),
      source("b-consumer.json", {
        modules: [{ ...shop(), source: "internal/infrastructure/shop" }],
      }),
    ]);

    expect(merged.catalog.modules).toHaveLength(1);
    // First source by path wins, as everywhere else at this level.
    expect(merged.catalog.modules?.[0]?.owner).toBe("shop.oms");
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.message).toContain("module");
  });

  it("keeps two genuinely different modules apart", () => {
    const merged = mergeCatalogs([
      source("a.json", { modules: [shop()] }),
      source("b.json", {
        modules: [
          {
            ...shop(),
            id: "buf.build/acme/pricing",
            slug: "acme-pricing",
            name: "acme/pricing",
          },
        ],
      }),
    ]);

    expect(merged.catalog.modules).toHaveLength(2);
    expect(merged.conflicts).toEqual([]);
  });

  // Optional in the file and absent downstream, exactly like `stores`.
  it("leaves modules off a catalog whose sources carried none", () => {
    const merged = mergeCatalogs([source("a.json", {})]);

    expect(merged.catalog.modules).toBeUndefined();
  });

  // Two extractors reading two halves of one service - the protos it publishes
  // and the copies it vendors - each name a module, and the service ends up
  // listing both.
  it("unions the modules a service names, across sources", () => {
    const publishes = context("shop", ["shop.oms"]);
    publishes.services = publishes.services.map((s) => ({
      ...s,
      modules: ["buf.build/acme/shop"],
    }));

    const vendors = context("shop", ["shop.oms"]);
    vendors.services = vendors.services.map((s) => ({
      ...s,
      modules: ["buf.build/acme/shop", "buf.build/acme/pricing"],
    }));

    const merged = mergeCatalogs([
      source("a-publishes.json", { contexts: [publishes] }),
      source("b-vendors.json", { contexts: [vendors] }),
    ]);

    expect(merged.catalog.contexts[0]?.services[0]?.modules).toEqual([
      "buf.build/acme/shop",
      "buf.build/acme/pricing",
    ]);
  });
});

describe("a second source that has seen the flow run", () => {
  const step = (id: string, status: "declared" | "verified", ref?: string) => ({
    type: "step" as const,
    id,
    from: "client",
    to: "auth.auth",
    kind: "rpc" as const,
    label: id,
    status,
    ...(ref ? { ref } : {}),
  });
  const flow = (steps: Catalog["flows"][number]["steps"]) => ({
    id: "flow.login",
    slug: "login",
    name: "Login",
    summary: "",
    owner: "auth",
    participants: [
      { id: "client", kind: "actor" as const, context: null },
      { id: "auth.auth", kind: "service" as const, context: "auth" },
    ],
    steps,
  });

  it("raises the steps it vouches for and leaves the rest as declared", () => {
    const merged = mergeCatalogs([
      source("a.json", { flows: [flow([step("s1", "declared"), step("s2", "declared")])] }),
      source("b.json", { flows: [flow([step("s1", "verified"), step("s2", "declared")])] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    const steps = merged.catalog.flows[0]?.steps ?? [];
    expect(steps.map((s) => (s.type === "step" ? s.status : s.type))).toEqual(["verified", "declared"]);
  });

  it("raises steps inside frames too", () => {
    const framed = (status: "declared" | "verified") => [
      {
        type: "alt" as const,
        id: "alt1",
        branches: [
          { title: "blocked", terminal: true, steps: [step("s2", status)] },
          { title: "otherwise", steps: [] },
        ],
      },
    ];
    const merged = mergeCatalogs([
      source("a.json", { flows: [flow(framed("declared"))] }),
      source("b.json", { flows: [flow(framed("verified"))] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    const alt = merged.catalog.flows[0]?.steps[0];
    expect(alt?.type === "alt" && alt.branches[0]?.steps[0]?.type === "step" ? alt.branches[0].steps[0].status : "").toBe("verified");
  });

  it("is a conflict when it disagrees about anything but status", () => {
    const merged = mergeCatalogs([
      source("a.json", { flows: [flow([step("s1", "declared")])] }),
      source("b.json", { flows: [flow([step("s1", "verified", "auth.v1.Users/login")])] }),
    ]);

    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.message).toContain("already declared");
    const first = merged.catalog.flows[0]?.steps[0];
    expect(first?.type === "step" ? first.status : "").toBe("declared");
  });

  it("does not touch the source it was handed", () => {
    const a = source("a.json", { flows: [flow([step("s1", "declared")])] });
    mergeCatalogs([a, source("b.json", { flows: [flow([step("s1", "verified")])] })]);

    const first = a.catalog.flows[0]?.steps[0];
    expect(first?.type === "step" ? first.status : "").toBe("declared");
  });

  it("lets verified win for a consumer and a call declared twice", () => {
    const withEdges = (status: "declared" | "verified") => {
      const ctx = context("shop", ["shop.oms"]);
      ctx.services[0]!.consumes = [{ id: "psp.v2.Charges/Create", peer: "psp", status, source: "x" }];
      ctx.services[0]!.aggregates = [
        {
          id: "shop.oms.order",
          slug: "order",
          name: "Order",
          readme: "",
          root: "Order",
          entities: [],
          valueObjects: [],
          operations: [],
          events: [
            {
              id: "shop.oms.order.OrderPlaced",
              slug: "order-placed",
              name: "OrderPlaced",
              versions: [{ version: "v1", doc: "", source: "", fields: [] }],
              consumers: [{ service: "payments.ledger", status, note: status === "verified" ? "seen in traces" : "" }],
            },
          ],
        },
      ];
      return ctx;
    };
    const merged = mergeCatalogs([
      source("a.json", { contexts: [withEdges("declared")] }),
      source("b.json", { contexts: [withEdges("verified")] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    const service = merged.catalog.contexts[0]?.services[0];
    expect(service?.consumes[0]?.status).toBe("verified");
    const consumer = service?.aggregates[0]?.events[0]?.consumers[0];
    expect(consumer?.status).toBe("verified");
    expect(consumer?.note).toBe("seen in traces");
  });
});
