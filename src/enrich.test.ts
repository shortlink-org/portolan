import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import type {
  BoundedContext,
  Catalog,
  Flow,
  FlowNode,
  Participant,
  Service,
  Status,
} from "./catalog";
import { validateCatalog } from "./catalog";
import { enrichCatalog } from "./enrich";
import { mergeCatalogs } from "./merge";
import { problems } from "./lib/derive";

// ---------------------------------------------------------------------------
// A tiny estate: two services, one event, one method, and whatever flow the
// case wants to say about them.
// ---------------------------------------------------------------------------

const EVENT = "shop.oms.order.OrderPlaced";
const METHOD = "pricing.v1.Pricing/Quote";

function service(
  contextId: string,
  slug: string,
  overrides: Partial<Service> = {},
): Service {
  return {
    id: `${contextId}.${slug}`,
    slug,
    name: slug,
    repo: "",
    path: "",
    readme: "",
    provides: [],
    consumes: [],
    aggregates: [],
    ...overrides,
  };
}

function context(id: string, services: Service[]): BoundedContext {
  return { id, slug: id, name: id, summary: "", services };
}

function oms(consumers: { service: string; status: Status; note?: string }[] = []): Service {
  return service("shop", "oms", {
    aggregates: [
      {
        id: "shop.oms.order",
        slug: "order",
        name: "Order",
        readme: "",
        root: "Order",
        entities: [
          { id: "shop.oms.order.order", slug: "order", name: "Order", doc: "", fields: [{ name: "id", type: "string", doc: "" }] },
        ],
        valueObjects: [],
        operations: [],
        events: [
          {
            id: EVENT,
            slug: "orderplaced",
            name: "OrderPlaced",
            versions: [{ version: "v1", doc: "", source: "x.go", fields: [] }],
            consumers,
          },
        ],
      },
    ],
  });
}

function pricing(): Service {
  return service("shop", "pricing", {
    provides: [
      { id: "pricing.v1.Pricing", methods: [{ name: "Quote", doc: "" }], source: "pricing.proto" },
    ],
  });
}

const LANES: Participant[] = [
  { id: "client", kind: "actor", context: null },
  { id: "shop.oms", kind: "service", context: "shop" },
  { id: "shop.pricing", kind: "service", context: "shop" },
  { id: "payments.ledger", kind: "service", context: "payments" },
  { id: "oms-db", kind: "store", context: "shop" },
  { id: "bus", kind: "broker", context: null },
  { id: "risk", kind: "external", context: null },
  { id: "ghost.svc", kind: "service", context: "ghost" },
];

let n = 0;
beforeEach(() => {
  n = 0;
});
function step(
  from: string,
  to: string,
  kind: "rpc" | "event" | "call",
  extra: Partial<Extract<FlowNode, { type: "step" }>> = {},
): FlowNode {
  n += 1;
  return { type: "step", id: `s${n}`, from, to, kind, status: "declared", ...extra };
}

function flow(slug: string, steps: FlowNode[], source?: string): Flow {
  return {
    id: `flow.${slug}`,
    slug,
    name: slug,
    summary: "",
    owner: "shop",
    participants: LANES,
    steps,
    ...(source ? { source } : {}),
  };
}

function estate(flows: Flow[], services: Service[] = [oms(), pricing()]): Catalog {
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    commit: "0000000",
    contexts: [
      context("shop", services),
      context("payments", [service("payments", "ledger")]),
    ],
    defs: {},
    flows,
    adrs: [],
  };
}

function consumersOf(catalog: Catalog) {
  return catalog.contexts
    .flatMap((c) => c.services)
    .flatMap((s) => s.aggregates)
    .flatMap((a) => a.events)
    .find((e) => e.id === EVENT)!.consumers;
}

function serviceOf(catalog: Catalog, id: string): Service {
  return catalog.contexts.flatMap((c) => c.services).find((s) => s.id === id)!;
}

// ---------------------------------------------------------------------------

describe("enrichCatalog: consumers from event steps", () => {
  it("reads a consumer out of a broker -> service step, with the step's status", () => {
    const c = estate([
      flow("a", [step("bus", "payments.ledger", "event", { ref: EVENT, status: "verified" })]),
    ]);
    const { catalog, derived } = enrichCatalog(c);

    expect(consumersOf(catalog)).toEqual([
      { service: "payments.ledger", status: "verified", via: { flow: "a", step: "s1" } },
    ]);
    expect(derived).toEqual([
      {
        kind: "consumer",
        ref: EVENT,
        service: "payments.ledger",
        status: "verified",
        via: { flow: "a", step: "s1" },
      },
    ]);
  });

  it("reads a consumer out of a service -> service step when no broker is drawn", () => {
    const c = estate([flow("a", [step("shop.oms", "payments.ledger", "event", { ref: EVENT })])]);
    expect(consumersOf(enrichCatalog(c).catalog).map((x) => x.service)).toEqual([
      "payments.ledger",
    ]);
  });

  it("does not read a publish, a write, a notification or a self-message as a consumer", () => {
    const c = estate([
      flow("a", [
        step("shop.oms", "bus", "event", { ref: EVENT }),
        step("shop.oms", "oms-db", "event", { ref: EVENT }),
        step("shop.oms", "client", "event", { ref: EVENT }),
        step("shop.oms", "shop.oms", "event", { ref: EVENT }),
      ]),
    ]);
    const { catalog, derived } = enrichCatalog(c);
    expect(derived).toEqual([]);
    expect(catalog).toBe(c);
  });

  it("marks a consumer nobody in the catalog answers to as unresolved, and it lands on Problems", () => {
    const c = estate([
      flow("a", [
        step("bus", "risk", "event", { ref: EVENT }),
        step("bus", "ghost.svc", "event", { ref: EVENT }),
      ]),
    ]);
    const { catalog } = enrichCatalog(c);
    expect(consumersOf(catalog).map((x) => [x.service, x.status])).toEqual([
      ["risk", "unresolved"],
      ["ghost.svc", "unresolved"],
    ]);
    expect(problems(catalog).map((p) => [p.kind, p.peer])).toEqual([
      ["consumer", "risk"],
      ["consumer", "ghost.svc"],
    ]);
  });

  it("lets a declared consumer win over the step, untouched", () => {
    const c = estate(
      [flow("a", [step("bus", "payments.ledger", "event", { ref: EVENT, status: "verified" })])],
      [oms([{ service: "payments.ledger", status: "declared", note: "by hand" }]), pricing()],
    );
    const { catalog, derived } = enrichCatalog(c);
    expect(derived).toEqual([]);
    expect(consumersOf(catalog)).toEqual([
      { service: "payments.ledger", status: "declared", note: "by hand" },
    ]);
  });

  it("records one consumer when two flows imply the same edge, from the first flow", () => {
    const c = estate([
      flow("a", [step("bus", "payments.ledger", "event", { ref: EVENT })]),
      flow("b", [step("bus", "payments.ledger", "event", { ref: EVENT, status: "verified" })]),
    ]);
    const list = consumersOf(enrichCatalog(c).catalog);
    expect(list).toHaveLength(1);
    expect(list[0]?.via).toEqual({ flow: "a", step: "s1" });
  });

  it("ignores a step whose ref is not an event the catalog has", () => {
    const c = estate([flow("a", [step("bus", "payments.ledger", "event", { ref: "nope.Event", status: "unresolved" })])]);
    expect(enrichCatalog(c).derived).toEqual([]);
  });

  it("sees steps inside alt, parallel and loop frames", () => {
    const c = estate([
      flow("a", [
        {
          type: "alt",
          id: "alt1",
          branches: [
            { title: "yes", steps: [step("bus", "payments.ledger", "event", { ref: EVENT })] },
            { title: "no", steps: [step("bus", "shop.pricing", "event", { ref: EVENT })] },
          ],
        },
        { type: "parallel", id: "par1", branches: [[step("bus", "ghost.svc", "event", { ref: EVENT })]] },
        { type: "loop", id: "loop1", title: "retry", steps: [step("bus", "risk", "event", { ref: EVENT })] },
      ]),
    ]);
    expect(consumersOf(enrichCatalog(c).catalog).map((x) => x.service)).toEqual([
      "payments.ledger",
      "shop.pricing",
      "ghost.svc",
      "risk",
    ]);
  });
});

describe("enrichCatalog: calls from rpc steps", () => {
  it("reads a call out of a service -> provider step, sourced from the flow", () => {
    const c = estate([
      flow("a", [step("shop.oms", "shop.pricing", "rpc", { ref: METHOD, status: "verified" })], "checkout_test.go"),
    ]);
    const { catalog, derived } = enrichCatalog(c);
    expect(serviceOf(catalog, "shop.oms").consumes).toEqual([
      {
        id: METHOD,
        peer: "shop.pricing",
        status: "verified",
        source: "checkout_test.go",
        via: { flow: "a", step: "s1" },
      },
    ]);
    expect(derived[0]).toMatchObject({ kind: "rpc", service: "shop.oms", peer: "shop.pricing" });
  });

  it("names the flow as the source when the flow has none", () => {
    const c = estate([flow("a", [step("shop.oms", "shop.pricing", "rpc", { ref: METHOD })])]);
    expect(serviceOf(enrichCatalog(c).catalog, "shop.oms").consumes[0]?.source).toBe("flow:a");
  });

  it("puts nothing on an actor, which has no consumes list", () => {
    const c = estate([flow("a", [step("client", "shop.pricing", "rpc", { ref: METHOD })])]);
    expect(enrichCatalog(c).derived).toEqual([]);
  });

  it("derives nothing from a method nobody provides or declares", () => {
    const c = estate([
      flow("a", [step("shop.oms", "shop.pricing", "rpc", { ref: "pricing.v1.Pricing/Nope", status: "unresolved" })]),
    ]);
    const { catalog, derived } = enrichCatalog(c);
    expect(derived).toEqual([]);
    expect(() => validateCatalog(c)).not.toThrow();
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it("is what lets a step naming a provided method validate: the call is now known", () => {
    // The validator resolves a step's ref against declared calls, not against
    // what peers provide. Before this pass the step names a method no service
    // is on record as calling; after it, shop.oms is.
    const c = estate([flow("a", [step("shop.oms", "shop.pricing", "rpc", { ref: METHOD })])]);
    expect(() => validateCatalog(c)).toThrow(/resolves to neither/);
    expect(() => validateCatalog(enrichCatalog(c).catalog)).not.toThrow();
  });

  it("reads a call to a system outside the estate as declared when its contract answers on the method", () => {
    const ASSESS = "risk.v1.Risk/Assess";
    const c: Catalog = {
      ...estate([flow("a", [step("shop.oms", "risk", "rpc", { ref: ASSESS })])]),
      externals: [
        {
          id: "risk",
          slug: "risk",
          name: "Risk",
          summary: "",
          provides: [{ id: "risk.v1.Risk", methods: [{ name: "Assess" }], source: "risk/openapi.yaml" }],
        },
      ],
    };
    const { catalog, derived } = enrichCatalog(c);
    expect(serviceOf(catalog, "shop.oms").consumes).toMatchObject([{ id: ASSESS, peer: "risk", status: "declared" }]);
    expect(derived[0]).toMatchObject({ kind: "rpc", peer: "risk", status: "declared" });
    expect(() => validateCatalog(catalog)).not.toThrow();
    // Declared, so not a problem: the far end is outside, and it is known.
    expect(problems(catalog)).toEqual([]);
  });

  it("marks a call to a peer that does not provide the method as unresolved", () => {
    // Somebody declared the call id, so the ref resolves; the step points it at
    // an external that provides nothing.
    const c = estate(
      [flow("a", [step("shop.oms", "risk", "rpc", { ref: METHOD })])],
      [oms(), pricing(), service("shop", "other", { consumes: [{ id: METHOD, peer: "shop.pricing", status: "declared", source: "x" }] })],
    );
    expect(serviceOf(enrichCatalog(c).catalog, "shop.oms").consumes).toMatchObject([
      { id: METHOD, peer: "risk", status: "unresolved" },
    ]);
  });

  it("lets a declared call win over the step", () => {
    const c = estate(
      [flow("a", [step("shop.oms", "shop.pricing", "rpc", { ref: METHOD, status: "verified" })])],
      [oms(), pricing()].map((s) =>
        s.id === "shop.oms"
          ? { ...s, consumes: [{ id: METHOD, peer: "shop.pricing", status: "declared", source: "by hand" }] }
          : s,
      ),
    );
    const { catalog, derived } = enrichCatalog(c);
    expect(derived).toEqual([]);
    expect(serviceOf(catalog, "shop.oms").consumes).toEqual([
      { id: METHOD, peer: "shop.pricing", status: "declared", source: "by hand" },
    ]);
  });

  it("ignores call steps", () => {
    const c = estate([flow("a", [step("shop.oms", "oms-db", "call", { ref: EVENT })])]);
    expect(enrichCatalog(c).derived).toEqual([]);
  });
});

describe("enrichCatalog: invariants", () => {
  const c = estate(
    [
      flow("a", [
        step("shop.oms", "shop.pricing", "rpc", { ref: METHOD }),
        step("shop.oms", "bus", "event", { ref: EVENT }),
        step("bus", "payments.ledger", "event", { ref: EVENT }),
        step("bus", "risk", "event", { ref: EVENT }),
      ]),
    ],
    [
      oms(),
      pricing(),
      service("shop", "other", {
        consumes: [{ id: METHOD, peer: "shop.pricing", status: "declared", source: "x" }],
      }),
    ],
  );

  it("never writes into the input", () => {
    const before = JSON.stringify(c);
    enrichCatalog(c);
    expect(JSON.stringify(c)).toBe(before);
  });

  it("is idempotent", () => {
    const once = enrichCatalog(c);
    const twice = enrichCatalog(once.catalog);
    expect(twice.derived).toEqual([]);
    expect(twice.catalog).toBe(once.catalog);
  });

  it("keeps a valid catalog valid", () => {
    expect(() => validateCatalog(c)).not.toThrow();
    expect(() => validateCatalog(enrichCatalog(c).catalog)).not.toThrow();
  });
});

describe("enrichCatalog: the auth fragment", () => {
  // The three fragments together, the way the app reads them: the domain one
  // alone names endpoints the api one declares.
  const raw = mergeCatalogs(
    ["domain", "api", "stores"].map((name) => ({
      path: `${name}.json`,
      catalog: JSON.parse(
        readFileSync(new URL(`../examples/auth/portolan/${name}.json`, import.meta.url), "utf8"),
      ) as Catalog,
    })),
  ).catalog;

  it("finds the one edge the extractor could not write: auth hears its own PasswordChanged", () => {
    const { catalog, derived } = enrichCatalog(raw);
    expect(derived).toEqual([
      {
        kind: "consumer",
        ref: "auth.auth.user.PasswordChanged",
        service: "auth.auth",
        status: "declared",
        via: { flow: "auth-revoke-sessions-on-password-change", step: "s1" },
      },
    ]);
    expect(() => validateCatalog(catalog)).not.toThrow();
    expect(problems(catalog)).toEqual(problems(raw));
  });
});

// ---------------------------------------------------------------------------

describe("enrichCatalog: an event named by the name it travels under", () => {
  /** The same estate, with a wire name on OrderPlaced. */
  function wired(name = "oms.OrderPlaced"): Service {
    const service = oms();
    service.aggregates[0]!.events[0]!.wire = { name, channel: "shop.oms.order" };
    return service;
  }

  function stepOf(catalog: Catalog, slug: string) {
    const found = catalog.flows.find((f) => f.slug === slug)!;
    return found.steps[0] as Extract<FlowNode, { type: "step" }>;
  }

  it("resolves a step that names the wire name, and reads the consumer off it", () => {
    // What an extractor can say about somebody else's message: the name on it.
    const listens = flow("listens", [
      step("bus", "shop.pricing", "event", { status: "unresolved", label: "oms.OrderPlaced" }),
    ]);
    const { catalog } = enrichCatalog(estate([listens], [wired(), pricing()]));

    const resolved = stepOf(catalog, "listens");
    expect(resolved.ref).toBe(EVENT);
    expect(resolved.status).toBe("declared");
    expect(consumersOf(catalog)).toEqual([
      { service: "shop.pricing", status: "declared", via: { flow: "listens", step: "s1" } },
    ]);
  });

  it("resolves the last segment when one event travels under it", () => {
    const listens = flow("listens", [
      step("bus", "shop.pricing", "event", { status: "unresolved", label: "OrderPlaced" }),
    ]);
    const { catalog } = enrichCatalog(estate([listens], [wired(), pricing()]));

    expect(stepOf(catalog, "listens").ref).toBe(EVENT);
  });

  it("leaves a segment two events answer to alone", () => {
    // Two publishers, one last segment: resolving it would put the listener on
    // somebody else's event, which is worse than leaving the step unresolved.
    const other = service("payments", "ledger", {
      aggregates: [
        {
          id: "payments.ledger.payment",
          slug: "payment",
          name: "Payment",
          readme: "",
          root: "Payment",
          entities: [],
          valueObjects: [],
          operations: [],
          events: [
            {
              id: "payments.ledger.payment.OrderPlaced",
              slug: "orderplaced",
              name: "OrderPlaced",
              versions: [{ version: "v1", doc: "", source: "x.java", fields: [] }],
              consumers: [],
              wire: { name: "ledger.OrderPlaced" },
            },
          ],
        },
      ],
    });
    const listens = flow("listens", [
      step("bus", "shop.pricing", "event", { status: "unresolved", label: "OrderPlaced" }),
    ]);
    const catalog = estate([listens], [wired(), pricing()]);
    catalog.contexts[1]!.services = [other];

    const enriched = enrichCatalog(catalog).catalog;
    expect(stepOf(enriched, "listens").ref).toBeUndefined();
    expect(stepOf(enriched, "listens").status).toBe("unresolved");
  });

  it("leaves a step that already resolves, and one nothing answers to", () => {
    const both = flow("both", [
      step("bus", "shop.pricing", "event", { ref: EVENT }),
      step("bus", "shop.pricing", "event", { status: "unresolved", label: "nothing.AtAll" }),
    ]);
    const { catalog } = enrichCatalog(estate([both], [wired(), pricing()]));

    const steps = catalog.flows[0]!.steps as Extract<FlowNode, { type: "step" }>[];
    expect(steps[0]!.status).toBe("declared");
    expect(steps[1]!.ref).toBeUndefined();
    expect(steps[1]!.status).toBe("unresolved");
  });

  it("sees a step inside a frame, and enriching twice changes nothing", () => {
    const nested = flow("nested", [
      {
        type: "alt",
        id: "alt1",
        branches: [
          {
            title: "the money arrived",
            steps: [step("bus", "shop.pricing", "event", { status: "unresolved", label: "oms.OrderPlaced" })],
          },
          { title: "otherwise", steps: [] },
        ],
      },
    ]);
    const once = enrichCatalog(estate([nested], [wired(), pricing()])).catalog;
    const twice = enrichCatalog(once).catalog;

    const inside = (catalog: Catalog) =>
      (catalog.flows[0]!.steps[0] as Extract<FlowNode, { type: "alt" }>).branches[0]!.steps[0] as Extract<FlowNode, { type: "step" }>;
    expect(inside(once).ref).toBe(EVENT);
    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------

describe("enrichCatalog: a foreign key into another service's table", () => {
  function estateWithStores(): Catalog {
    const catalog = estate([]);
    catalog.stores = [
      {
        id: "delivery.core.pg",
        slug: "pg",
        name: "Delivery database",
        kind: "postgres",
        owner: "delivery.core",
        tables: [
          {
            id: "delivery.core.pg.packages",
            name: "packages",
            columns: [
              { name: "id", type: "text", nullable: false, pk: true },
              // What the extractor leaves when the table is not in its store.
              { name: "order_id", type: "text", nullable: false, fk: { table: "orders", column: "id" } },
            ],
          },
        ],
      },
      {
        id: "shop.oms.pg",
        slug: "pg",
        name: "Order database",
        kind: "postgres",
        owner: "shop.oms",
        tables: [
          {
            id: "shop.oms.pg.orders",
            name: "orders",
            columns: [{ name: "id", type: "text", nullable: false, pk: true }],
          },
        ],
      },
    ];
    return catalog;
  }

  function keyOf(catalog: Catalog) {
    return catalog.stores![0]!.tables[0]!.columns[1]!.fk!.table;
  }

  it("resolves a name exactly one table in the estate answers to", () => {
    expect(keyOf(enrichCatalog(estateWithStores()).catalog)).toBe("shop.oms.pg.orders");
  });

  it("leaves a name two tables answer to alone", () => {
    const catalog = estateWithStores();
    catalog.stores!.push({
      id: "payments.ledger.pg",
      slug: "pg",
      name: "Ledger database",
      kind: "postgres",
      owner: "payments.ledger",
      tables: [{ id: "payments.ledger.pg.orders", name: "orders", columns: [] }],
    });

    expect(keyOf(enrichCatalog(catalog).catalog)).toBe("orders");
  });

  it("leaves a key that already resolves untouched, and enriching twice changes nothing", () => {
    const once = enrichCatalog(estateWithStores()).catalog;
    const twice = enrichCatalog(once).catalog;

    expect(keyOf(twice)).toBe("shop.oms.pg.orders");
    expect(twice).toEqual(once);
  });
});
