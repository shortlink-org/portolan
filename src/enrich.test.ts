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
import { validateCatalog, walkSteps } from "./catalog";
import { enrichCatalog } from "./enrich";
import { contextMap } from "./lib/context-map";
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

function oms(
  consumers: { service: string; status: Status; note?: string }[] = [],
): Service {
  return service("shop", "oms", {
    aggregates: [
      {
        id: "shop.oms.order",
        slug: "order",
        name: "Order",
        readme: "",
        root: "Order",
        entities: [
          {
            id: "shop.oms.order.order",
            slug: "order",
            name: "Order",
            doc: "",
            fields: [{ name: "id", type: "string", doc: "" }],
          },
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
      {
        id: "pricing.v1.Pricing",
        methods: [
          {
            name: "Quote",
            doc: "",
            request: "QuoteRequest",
            response: "QuoteResponse",
          },
        ],
        source: "pricing.proto",
      },
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
  kind: "rpc" | "event" | "call" | "response",
  extra: Partial<Extract<FlowNode, { type: "step" }>> = {},
): FlowNode {
  n += 1;
  return {
    type: "step",
    id: `s${n}`,
    from,
    to,
    kind,
    status: "declared",
    ...extra,
  };
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

function estate(
  flows: Flow[],
  services: Service[] = [oms(), pricing()],
): Catalog {
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

describe("enrichCatalog: HTTP route correlation", () => {
  function httpProvider(
    slug: string,
    operation: string,
    path: string,
  ): Service {
    return service("shop", slug, {
      provides: [
        {
          id: "api",
          source: `${slug}/openapi.yaml`,
          methods: [
            {
              name: operation,
              doc: "",
              request: "",
              response: "",
              http: { method: "POST", path },
            },
          ],
        },
      ],
    });
  }

  function httpCaller(
    path: string,
    provides: Service["provides"] = [],
  ): Service {
    return service("shop", "oms", {
      provides,
      consumes: [
        {
          id: `http-client/POST ${path}`,
          peer: "http-peer",
          status: "unresolved",
          source: "client.go:10",
        },
      ],
    });
  }

  it("maps an outbound route to the unique other service that provides it", () => {
    const callerProvides = httpProvider("oms", "POST /book", "/book").provides;
    const caller = httpCaller("/book", callerProvides);
    const supp = httpProvider("aviasupp", "POST /book", "/book");
    const outbound = flow("book", [
      step("shop.oms", "http-peer", "rpc", {
        ref: "http-client/POST /book",
        label: "POST /book",
        status: "unresolved",
      }),
    ]);

    const once = enrichCatalog(estate([outbound], [caller, supp])).catalog;
    expect(serviceOf(once, "shop.oms").consumes).toEqual([
      expect.objectContaining({
        id: "api/POST /book",
        peer: "shop.aviasupp",
        status: "declared",
      }),
    ]);
    expect(walkSteps(once.flows[0]!.steps)[0]).toEqual(
      expect.objectContaining({
        ref: "api/POST /book",
        to: "shop.aviasupp",
        status: "declared",
      }),
    );
    expect(once.flows[0]!.participants).toContainEqual({
      id: "shop.aviasupp",
      kind: "service",
      context: "shop",
    });
    expect(enrichCatalog(once).catalog).toEqual(once);
  });

  it("never confirms a link against a mounted route whose verb is unknown", () => {
    // extract-django keeps a mounted `Planet.fetch` in `provides` with an
    // empty method when no declaration proves the verb; the path alone is a
    // candidate to look at, not a fact to link on.
    const caller = httpCaller("/geo/planet/fetch");
    const geo = service("shop", "geo", {
      provides: [
        {
          id: "shop.geo.geo",
          source: "geo/portolan/openapi.inferred.yaml",
          methods: [
            {
              name: "geo_planet_fetch",
              doc: "",
              request: "",
              response: "",
              http: { method: "", path: "/geo/planet/fetch" },
            },
          ],
        },
      ],
    });

    const once = enrichCatalog(estate([], [caller, geo])).catalog;
    expect(serviceOf(once, "shop.oms").consumes).toEqual([
      expect.objectContaining({
        id: "http-client/POST /geo/planet/fetch",
        status: "unresolved",
      }),
    ]);
  });

  it("joins HTTP integrations contributed by independently added projects", () => {
    const caller = service("aviacore", "aviacore", {
      consumes: [
        {
          id: "http-client/POST /book",
          peer: "http-peer",
          status: "unresolved",
          source: "internal/supplier/client.go:42",
        },
      ],
    });
    const provider = service("aviasupp", "aviasupp", {
      provides: [
        {
          id: "api",
          source: "docs/openapi.yaml",
          methods: [
            {
              name: "book_post",
              doc: "",
              request: "",
              response: "",
              http: { method: "POST", path: "/book" },
            },
          ],
        },
      ],
    });
    const fragment = (id: string, owned: Service): Catalog => ({
      generatedAt: "2026-01-01T00:00:00Z",
      commit: id,
      contexts: [context(id, [owned])],
      defs: {},
      flows: [],
      adrs: [],
    });
    const merged = mergeCatalogs([
      {
        path: "vendor/repos/avia/aviacore/portolan/http-clients.json",
        catalog: fragment("aviacore", caller),
      },
      {
        path: "vendor/repos/avia/aviasupp/portolan/api.json",
        catalog: fragment("aviasupp", provider),
      },
    ]).catalog;

    const resolved = enrichCatalog(merged).catalog;
    const call = serviceOf(resolved, "aviacore.aviacore").consumes[0];
    expect(call).toMatchObject({
      id: "api/book_post",
      peer: "aviasupp.aviasupp",
      status: "declared",
      source: "internal/supplier/client.go:42",
    });
    expect(
      contextMap(resolved).find(
        (relation) => relation.id === "aviacore~aviasupp",
      ),
    ).toMatchObject({
      dependencies: [
        {
          upstream: "aviasupp",
          downstream: "aviacore",
          links: [
            {
              id: "api/book_post",
              from: "aviasupp.aviasupp",
              to: "aviacore.aviacore",
              status: "declared",
            },
          ],
        },
      ],
    });
    expect(() => validateCatalog(resolved)).not.toThrow();
  });

  it("maps a unique mounted route by its complete segment suffix", () => {
    const caller = httpCaller("/get-admin-settings");
    const admin = httpProvider(
      "aviaadmin",
      "settings_get_admin_settings_post",
      "/settings/get-admin-settings",
    );
    const unrelatedParameterRoute = httpProvider(
      "files",
      "fileByID",
      "/files/{id}",
    );

    const result = enrichCatalog(
      estate([], [caller, admin, unrelatedParameterRoute]),
    ).catalog;
    expect(serviceOf(result, "shop.oms").consumes[0]).toEqual(
      expect.objectContaining({
        id: "api/settings_get_admin_settings_post",
        peer: "shop.aviaadmin",
        status: "declared",
      }),
    );
  });

  it("uses a proven full path even when another project has the same suffix", () => {
    const caller = httpCaller("/get-admin-settings");
    caller.consumes[0]!.destination = {
      callSite: "client.go:10", endpointExpression: "c.baseURL + path", method: "POST",
      localPath: "/get-admin-settings", fullPath: "/settings/get-admin-settings",
      baseURL: { expression: "cfg.SettingAddr", configField: "Config.SettingAddr", environmentVariable: "SETTINGS_ADDR", kind: "config-default", value: "http://localhost:8000/settings", source: "config.go:84" },
      join: { expression: "c.baseURL + path", source: "client.go:10" },
    };
    const admin = httpProvider("aviaadmin", "settings", "/settings/get-admin-settings");
    const other = httpProvider("other", "settings", "/other/get-admin-settings");
    const result = enrichCatalog(estate([], [caller, admin, other])).catalog;
    expect(serviceOf(result, "shop.oms").consumes[0]).toMatchObject({ peer: "shop.aviaadmin", destination: { resolution: { basis: "full-path", route: "/settings/get-admin-settings" }, baseURL: { configField: "Config.SettingAddr" } } });
    const missing = enrichCatalog(estate([], [caller, other])).catalog;
    expect(serviceOf(missing, "shop.oms").consumes[0]!.status).toBe("unresolved");
    expect(enrichCatalog(result).catalog).toEqual(result);
  });

  it("leaves ambiguous routes and possible self-calls unresolved", () => {
    const caller = httpCaller("/book");
    const first = httpProvider("first", "createBook", "/book");
    const second = httpProvider("second", "book", "/book");

    const ambiguous = enrichCatalog(
      estate([], [caller, first, second]),
    ).catalog;
    expect(serviceOf(ambiguous, "shop.oms").consumes[0]).toEqual(
      caller.consumes[0],
    );

    const selfOnly = enrichCatalog(
      estate(
        [],
        [httpCaller("/book", httpProvider("oms", "book", "/book").provides)],
      ),
    ).catalog;
    expect(serviceOf(selfOnly, "shop.oms").consumes[0]).toEqual(
      caller.consumes[0],
    );

    const rootWithoutRootProvider = enrichCatalog(
      estate([], [httpCaller("/"), first]),
    ).catalog;
    expect(serviceOf(rootWithoutRootProvider, "shop.oms").consumes[0]).toEqual(
      httpCaller("/").consumes[0],
    );
  });

  // PORTOLAN-19: the extractor qualifies a raw call with its destination, so
  // the same route addressed to two hosts arrives as two consumes. They must
  // stay two - resolved to two providers when the estate has them, or two
  // unresolved calls when it does not - never one glued entry.
  it("keeps the same route to two hosts as two calls", () => {
    const toHost = (host: string): Service["consumes"][number] => ({
      id: `http-client/POST /foo @ ${host}`,
      peer: host.replace(".", "-"),
      status: "unresolved",
      source: "client.go:11",
      destination: {
        callSite: "client.go:11",
        endpointExpression: "path",
        method: "POST",
        localPath: "/foo",
        fullPath: "/foo",
        serviceDiscoveryAlias: host,
      },
    });
    const caller = service("shop", "oms", {
      consumes: [toHost("payments.internal"), toHost("ledger.internal")],
    });
    const payments = httpProvider("payments", "POST /foo", "/foo");
    const ledger = httpProvider("ledger", "POST /foo", "/foo");

    const ambiguous = enrichCatalog(
      estate([], [caller, payments, ledger]),
    ).catalog;
    expect(
      serviceOf(ambiguous, "shop.oms").consumes.map((call) => [
        call.id,
        call.peer,
        call.status,
      ]),
    ).toEqual([
      ["http-client/POST /foo @ payments.internal", "payments-internal", "unresolved"],
      ["http-client/POST /foo @ ledger.internal", "ledger-internal", "unresolved"],
    ]);
  });

  // The same two providers, and now the manifests say which name each one
  // answers on. The host the call names decides between them; a host nobody
  // answers on decides nothing.
  it("lets the manifests decide between two providers of one route", () => {
    const toHost = (host: string): Service["consumes"][number] => ({
      id: `http-client/POST /foo @ ${host}`,
      peer: host.replace(".", "-"),
      status: "unresolved",
      source: "client.go:11",
      destination: {
        callSite: "client.go:11",
        endpointExpression: "path",
        method: "POST",
        localPath: "/foo",
        fullPath: "/foo",
        serviceDiscoveryAlias: host,
      },
    });
    const caller = service("shop", "oms", {
      consumes: [
        toHost("payments.internal"),
        toHost("ledger.internal"),
        toHost("nobody.internal"),
      ],
    });
    const payments = {
      ...httpProvider("payments", "pay", "/foo"),
      hosts: ["payments", "payments.internal"],
    };
    const ledger = {
      ...httpProvider("ledger", "post", "/foo"),
      hosts: ["ledger.internal"],
    };

    const out = enrichCatalog(estate([], [caller, payments, ledger])).catalog;
    expect(
      serviceOf(out, "shop.oms").consumes.map((call) => [
        call.id,
        call.peer,
        call.status,
        call.destination?.resolution?.basis,
      ]),
    ).toEqual([
      ["api/pay", "shop.payments", "declared", "kubernetes-host"],
      ["api/post", "shop.ledger", "declared", "kubernetes-host"],
      [
        "http-client/POST /foo @ nobody.internal",
        "nobody-internal",
        "unresolved",
        undefined,
      ],
    ]);
  });

  it("uses what the caller dials when the call names no host", () => {
    const caller = service("shop", "oms", {
      consumes: [
        {
          id: "http-client/POST /foo",
          peer: "http-peer",
          status: "unresolved",
          source: "client.go:10",
        },
      ],
      dials: ["ledger.payments.svc"],
    });
    const payments = {
      ...httpProvider("payments", "pay", "/foo"),
      hosts: ["payments.shop.svc"],
    };
    const ledger = {
      ...httpProvider("ledger", "post", "/foo"),
      hosts: ["ledger.payments.svc"],
    };

    const out = enrichCatalog(estate([], [caller, payments, ledger])).catalog;
    expect(
      serviceOf(out, "shop.oms").consumes.map((call) => [
        call.id,
        call.peer,
        call.status,
        call.destination?.resolution?.basis,
      ]),
    ).toEqual([["api/post", "shop.ledger", "declared", "kubernetes-host"]]);
  });

  it("resolves a destination-qualified route like a bare one", () => {
    const caller = service("shop", "oms", {
      consumes: [
        {
          id: "http-client/POST /book @ Config.SupplierURL",
          peer: "http-peer",
          status: "unresolved",
          source: "client.go:10",
        },
      ],
    });
    const supp = httpProvider("aviasupp", "POST /book", "/book");
    const once = enrichCatalog(estate([], [caller, supp])).catalog;
    expect(serviceOf(once, "shop.oms").consumes).toEqual([
      expect.objectContaining({
        id: "api/POST /book",
        peer: "shop.aviasupp",
        status: "declared",
        destination: expect.objectContaining({
          resolution: { basis: "exact-route", provider: "shop.aviasupp", route: "/book" },
        }),
      }),
    ]);
    expect(enrichCatalog(once).catalog).toEqual(once);
  });
});

// ---------------------------------------------------------------------------

describe("enrichCatalog: asynchronous outbound continuations", () => {
  function outbound(slug: string, entrypoint: string, path: string): Flow {
    return {
      ...flow(slug, [
        step("shop.oms", "risk", "rpc", {
          ref: `http-client/POST ${path}`,
          label: `POST ${path}`,
          status: "unresolved",
        }),
      ]),
      entrypoint,
    };
  }

  it("joins a dispatched worker to its uniquely proven outbound flow", () => {
    const entrypoint = "jobs/email:SendWorker.Work";
    const queued = flow("send-job", [
      step("bus", "shop.oms", "call", {
        label: "SendWorker.Work",
        continuesAt: entrypoint,
      }),
    ]);
    const once = enrichCatalog(
      estate([queued, outbound("send-http", entrypoint, "/mail")]),
    ).catalog;

    expect(once.flows.map((item) => item.slug)).toEqual(["send-job"]);
    expect(walkSteps(once.flows[0]!.steps).map((item) => item.label)).toEqual([
      "SendWorker.Work",
      "POST /mail",
    ]);
    expect(walkSteps(once.flows[0]!.steps)[1]!.id).toContain(
      "continuation-send-http",
    );
    expect(once.flows[0]!.participants.some((item) => item.id === "risk")).toBe(
      true,
    );
    expect(enrichCatalog(once).catalog).toEqual(once);
  });

  it("does not choose between duplicate entrypoint flows", () => {
    const entrypoint = "jobs/email:SendWorker.Work";
    const queued = flow("send-job", [
      step("bus", "shop.oms", "call", { continuesAt: entrypoint }),
    ]);
    const result = enrichCatalog(
      estate([
        queued,
        outbound("send-primary", entrypoint, "/one"),
        outbound("send-secondary", entrypoint, "/two"),
      ]),
    ).catalog;

    expect(result.flows).toHaveLength(3);
    expect(walkSteps(result.flows[0]!.steps)).toHaveLength(1);
  });

  it("composes an API path through a River job into its HTTP continuation", () => {
    const producer = "connector/websky:Connector.Void";
    const worker = "connector/websky:VoidWorker.Work";
    const api = {
      ...flow("void-api", [
        step("client", "shop.oms", "rpc", {
          label: "POST /void",
          reaches: [producer],
        }),
      ]),
      trigger: {
        kind: "http",
        label: "POST /void",
        confidence: "high",
      } as const,
    };
    const job = {
      ...flow("void-job", [
        step("shop.oms", "bus", "call", {
          label: "enqueue void",
          handoff: {
            kind: "job",
            transport: "river",
            channel: "void",
            message: "void-cancellation",
            direction: "send",
          },
        }),
        step("bus", "shop.oms", "call", {
          label: "VoidWorker.Work",
          continuesAt: worker,
          handoff: {
            kind: "job",
            transport: "river",
            channel: "void",
            message: "void-cancellation",
            direction: "receive",
          },
        }),
      ]),
      entrypoint: producer,
      trigger: {
        kind: "job",
        label: "River · void",
        confidence: "high",
      } as const,
    };

    const once = enrichCatalog(
      estate([api, job, outbound("void-http", worker, "/cancel")]),
    ).catalog;
    const root = once.flows.find((item) => item.slug === "void-api")!;

    expect(walkSteps(root.steps).map((item) => item.label)).toEqual([
      "POST /void",
      "enqueue void",
      "VoidWorker.Work",
      "POST /cancel",
      "HTTP response",
    ]);
    expect(root.includes).toEqual(["void-job", "void-http"]);
    expect(once.flows.map((item) => item.slug)).toEqual([
      "void-api",
      "void-job",
    ]);
    expect(enrichCatalog(once).catalog).toEqual(once);
  });

  it("joins a Django enqueue at the Celery worker without replaying the task flow enqueue", () => {
    const handoff = (direction: "send" | "receive") => ({
      kind: "job" as const,
      transport: "celery",
      channel: "billing.mail",
      message: "invoices.tasks.send_invoice_email",
      direction,
    });
    const api = {
      ...flow("issue-invoice", [
        step("client", "shop.oms", "rpc", {
          label: "POST /invoices/{id}/issue",
        }),
        step("shop.oms", "bus", "call", {
          label: "enqueue send_invoice_email",
          handoff: handoff("send"),
        }),
      ]),
      trigger: {
        kind: "http",
        label: "POST /invoices/{id}/issue",
        confidence: "high",
      } as const,
    };
    const task = {
      ...flow("send-invoice-email", [
        step("shop.oms", "bus", "call", {
          label: "enqueue send_invoice_email",
          handoff: handoff("send"),
        }),
        step("bus", "shop.oms", "call", {
          label: "send_invoice_email",
          handoff: handoff("receive"),
        }),
      ]),
      trigger: {
        kind: "job",
        label: "Celery · billing.mail",
        confidence: "high",
      } as const,
    };

    const result = enrichCatalog(estate([api, task])).catalog;
    const root = result.flows.find((item) => item.slug === "issue-invoice")!;

    expect(walkSteps(root.steps).map((item) => item.label)).toEqual([
      "POST /invoices/{id}/issue",
      "enqueue send_invoice_email",
      "send_invoice_email",
      "HTTP response",
    ]);
    expect(root.includes).toEqual(["send-invoice-email"]);
    expect(enrichCatalog(result).catalog).toEqual(result);
  });

  it("composes a message handoff and its nested outbound call", () => {
    const handler = "messages/email:Handle";
    const publish = {
      ...flow("request", [
        step("shop.oms", "bus", "event", {
          label: "publish email.requested",
          handoff: {
            kind: "message",
            transport: "kafka",
            channel: "email.requested",
            direction: "send",
          },
        }),
      ]),
      trigger: {
        kind: "http",
        label: "POST /email",
        confidence: "high",
      } as const,
    };
    const consume = {
      ...flow("email-handler", [
        step("bus", "shop.oms", "event", {
          label: "email.requested",
          continuesAt: handler,
          handoff: {
            kind: "message",
            transport: "kafka",
            channel: "email.requested",
            direction: "receive",
          },
        }),
      ]),
      trigger: {
        kind: "event",
        label: "email.requested",
        confidence: "high",
      } as const,
    };

    const once = enrichCatalog(
      estate([publish, consume, outbound("email-http", handler, "/mail")]),
    ).catalog;
    const root = once.flows.find((item) => item.slug === "request")!;

    expect(walkSteps(root.steps).map((item) => item.label)).toEqual([
      "publish email.requested",
      "email.requested",
      "POST /mail",
    ]);
    expect(root.includes).toEqual(["email-handler", "email-http"]);
    expect(enrichCatalog(once).catalog).toEqual(once);
  });

  it("synthesizes returns for nested unary rpc and the HTTP root", () => {
    const entrypoint = "pricing/rpc:Server.Quote";
    const api = {
      ...flow("quote-api", [
        step("client", "shop.oms", "rpc", { label: "GET /quote" }),
        step("shop.oms", "shop.pricing", "rpc", {
          ref: METHOD,
          label: "Quote",
          continuesAt: entrypoint,
        }),
      ]),
      trigger: {
        kind: "http",
        label: "GET /quote",
        confidence: "high",
      } as const,
    };
    const provider = {
      ...flow("quote-rpc", [
        step("shop.pricing", "shop.pricing", "call", {
          label: "load quote",
        }),
      ]),
      entrypoint,
      trigger: {
        kind: "unproven",
        label: METHOD,
        confidence: "high",
      } as const,
    };

    const once = enrichCatalog(estate([api, provider])).catalog;
    const root = once.flows.find((item) => item.slug === "quote-api")!;
    const steps = walkSteps(root.steps);

    expect(
      steps.map((item) => [item.kind, item.from, item.to, item.label]),
    ).toEqual([
      ["rpc", "client", "shop.oms", "GET /quote"],
      ["rpc", "shop.oms", "shop.pricing", "Quote"],
      ["call", "shop.pricing", "shop.pricing", "load quote"],
      ["response", "shop.pricing", "shop.oms", "QuoteResponse"],
      ["response", "shop.oms", "client", "HTTP response"],
    ]);
    expect(steps[3]!.replyTo).toBe(steps[1]!.id);
    expect(steps[4]!.replyTo).toBe(steps[0]!.id);
    expect(enrichCatalog(once).catalog).toEqual(once);
  });

  it("hydrates a source-proven HTTP body from the serialized rpc response", () => {
    const api = {
      ...flow("quote-api", [
        step("client", "shop.oms", "rpc", { label: "GET /quote" }),
        step("shop.oms", "shop.pricing", "rpc", {
          ref: METHOD,
          label: "Quote",
        }),
        step("shop.oms", "client", "response", {
          label: "200 · HTTP response",
          replyTo: "s1",
          http: {
            status: 200,
            contentType: "application/json",
            bodyRef: METHOD,
            encoding: "protojson",
            outcome: "success",
          },
        }),
      ]),
      trigger: {
        kind: "http",
        label: "GET /quote",
        confidence: "high",
      } as const,
    };

    const once = enrichCatalog(estate([api])).catalog;
    const response = walkSteps(once.flows[0]!.steps).at(-1)!;

    expect(response.label).toBe("200 · QuoteResponse");
    expect(response.http?.body).toBe("QuoteResponse");
    expect(response.http?.bodyRef).toBe(METHOD);
    expect(enrichCatalog(once).catalog).toEqual(once);
  });

  it("does not synthesize a unary return for a streaming rpc", () => {
    const entrypoint = "pricing/rpc:Server.Watch";
    const api = {
      ...flow("watch-api", [
        step("client", "shop.oms", "rpc", { label: "GET /watch" }),
        step("shop.oms", "shop.pricing", "rpc", {
          ref: METHOD,
          label: "Quote",
          continuesAt: entrypoint,
        }),
      ]),
      trigger: {
        kind: "http",
        label: "GET /watch",
        confidence: "high",
      } as const,
    };
    const provider = {
      ...flow("watch-rpc", [
        step("shop.pricing", "shop.pricing", "call", { label: "watch" }),
      ]),
      entrypoint,
    };
    const streaming = pricing();
    streaming.provides[0]!.methods[0]!.streaming = "server";

    const result = enrichCatalog(
      estate([api, provider], [oms(), streaming]),
    ).catalog;
    const responses = walkSteps(result.flows[0]!.steps).filter(
      (item) => item.kind === "response",
    );

    expect(responses.map((item) => item.label)).toEqual(["HTTP response"]);
  });

  it("refuses an ambiguous message handoff", () => {
    const publisher = flow("publisher", [
      step("shop.oms", "bus", "event", {
        handoff: {
          kind: "message",
          transport: "kafka",
          channel: "shared",
          direction: "send",
        },
      }),
    ]);
    const consumer = (slug: string): Flow =>
      flow(slug, [
        step("bus", "shop.oms", "event", {
          handoff: {
            kind: "message",
            transport: "kafka",
            channel: "shared",
            direction: "receive",
          },
        }),
      ]);

    const result = enrichCatalog(
      estate([publisher, consumer("first"), consumer("second")]),
    ).catalog;
    expect(result.flows[0]!.includes).toBeUndefined();
    expect(walkSteps(result.flows[0]!.steps)).toHaveLength(1);
  });

  it("composes an exact message handoff across service boundaries", () => {
    const publisher = flow("publisher", [
      step("shop.oms", "bus", "event", {
        label: "publish payment.requested",
        handoff: {
          kind: "message",
          transport: "kafka",
          channel: "payment.requested",
          direction: "send",
        },
      }),
    ]);
    const consumer: Flow = {
      ...flow("ledger-consumer", [
        step("bus", "payments.ledger", "event", {
          label: "handle payment.requested",
          handoff: {
            kind: "message",
            transport: "kafka",
            channel: "payment.requested",
            direction: "receive",
          },
        }),
      ]),
      owner: "payments",
      trigger: {
        kind: "event",
        label: "payment.requested",
        confidence: "high",
      },
    };

    const result = enrichCatalog(estate([publisher, consumer])).catalog;
    expect(result.flows[0]!.includes).toEqual(["ledger-consumer"]);
    expect(
      result.flows[0]!.participants.some(
        (participant) => participant.id === "payments.ledger",
      ),
    ).toBe(true);
  });

  it("stops recursive handoff cycles and remains idempotent", () => {
    const chained = (slug: string, input: string, output: string): Flow => ({
      ...flow(slug, [
        step("bus", "shop.oms", "event", {
          label: `receive ${input}`,
          handoff: {
            kind: "message",
            transport: "kafka",
            channel: input,
            direction: "receive",
          },
        }),
        step("shop.oms", "bus", "event", {
          label: `publish ${output}`,
          handoff: {
            kind: "message",
            transport: "kafka",
            channel: output,
            direction: "send",
          },
        }),
      ]),
      trigger: { kind: "event", label: input, confidence: "high" },
    });

    const once = enrichCatalog(
      estate([
        chained("alpha", "alpha", "beta"),
        chained("beta", "beta", "alpha"),
      ]),
    ).catalog;
    expect(once.flows[0]!.includes).toEqual(["beta"]);
    expect(walkSteps(once.flows[0]!.steps)).toHaveLength(4);
    expect(enrichCatalog(once).catalog).toEqual(once);
  });
});

// ---------------------------------------------------------------------------

describe("enrichCatalog: consumers from event steps", () => {
  it("reads a consumer out of a broker -> service step, with the step's status", () => {
    const c = estate([
      flow("a", [
        step("bus", "payments.ledger", "event", {
          ref: EVENT,
          status: "verified",
        }),
      ]),
    ]);
    const { catalog, derived } = enrichCatalog(c);

    expect(consumersOf(catalog)).toEqual([
      {
        service: "payments.ledger",
        status: "verified",
        via: { flow: "a", step: "s1" },
      },
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
    const c = estate([
      flow("a", [step("shop.oms", "payments.ledger", "event", { ref: EVENT })]),
    ]);
    expect(consumersOf(enrichCatalog(c).catalog).map((x) => x.service)).toEqual(
      ["payments.ledger"],
    );
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
      [
        flow("a", [
          step("bus", "payments.ledger", "event", {
            ref: EVENT,
            status: "verified",
          }),
        ]),
      ],
      [
        oms([
          { service: "payments.ledger", status: "declared", note: "by hand" },
        ]),
        pricing(),
      ],
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
      flow("b", [
        step("bus", "payments.ledger", "event", {
          ref: EVENT,
          status: "verified",
        }),
      ]),
    ]);
    const list = consumersOf(enrichCatalog(c).catalog);
    expect(list).toHaveLength(1);
    expect(list[0]?.via).toEqual({ flow: "a", step: "s1" });
  });

  it("ignores a step whose ref is not an event the catalog has", () => {
    const c = estate([
      flow("a", [
        step("bus", "payments.ledger", "event", {
          ref: "nope.Event",
          status: "unresolved",
        }),
      ]),
    ]);
    expect(enrichCatalog(c).derived).toEqual([]);
  });

  it("sees steps inside alt, parallel and loop frames", () => {
    const c = estate([
      flow("a", [
        {
          type: "alt",
          id: "alt1",
          branches: [
            {
              title: "yes",
              steps: [step("bus", "payments.ledger", "event", { ref: EVENT })],
            },
            {
              title: "no",
              steps: [step("bus", "shop.pricing", "event", { ref: EVENT })],
            },
          ],
        },
        {
          type: "parallel",
          id: "par1",
          branches: [[step("bus", "ghost.svc", "event", { ref: EVENT })]],
        },
        {
          type: "loop",
          id: "loop1",
          title: "retry",
          steps: [step("bus", "risk", "event", { ref: EVENT })],
        },
      ]),
    ]);
    expect(consumersOf(enrichCatalog(c).catalog).map((x) => x.service)).toEqual(
      ["payments.ledger", "shop.pricing", "ghost.svc", "risk"],
    );
  });
});

describe("enrichCatalog: calls from rpc steps", () => {
  it("reads a call out of a service -> provider step, sourced from the flow", () => {
    const c = estate([
      flow(
        "a",
        [
          step("shop.oms", "shop.pricing", "rpc", {
            ref: METHOD,
            status: "verified",
          }),
        ],
        "checkout_test.go",
      ),
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
    expect(derived[0]).toMatchObject({
      kind: "rpc",
      service: "shop.oms",
      peer: "shop.pricing",
    });
  });

  it("names the flow as the source when the flow has none", () => {
    const c = estate([
      flow("a", [step("shop.oms", "shop.pricing", "rpc", { ref: METHOD })]),
    ]);
    expect(
      serviceOf(enrichCatalog(c).catalog, "shop.oms").consumes[0]?.source,
    ).toBe("flow:a");
  });

  it("puts nothing on an actor, which has no consumes list", () => {
    const c = estate([
      flow("a", [step("client", "shop.pricing", "rpc", { ref: METHOD })]),
    ]);
    expect(enrichCatalog(c).derived).toEqual([]);
  });

  it("derives nothing from a method nobody provides or declares", () => {
    const c = estate([
      flow("a", [
        step("shop.oms", "shop.pricing", "rpc", {
          ref: "pricing.v1.Pricing/Nope",
          status: "unresolved",
        }),
      ]),
    ]);
    const { catalog, derived } = enrichCatalog(c);
    expect(derived).toEqual([]);
    expect(() => validateCatalog(c)).not.toThrow();
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it("keeps a step naming a provided method valid while recording its caller", () => {
    // The provided method is enough to resolve the flow step. Enrichment adds
    // the separate fact that shop.oms is one of its callers.
    const c = estate([
      flow("a", [step("shop.oms", "shop.pricing", "rpc", { ref: METHOD })]),
    ]);
    expect(() => validateCatalog(c)).not.toThrow();
    expect(() => validateCatalog(enrichCatalog(c).catalog)).not.toThrow();
  });

  it("reads a call to a system outside the estate as declared when its contract answers on the method", () => {
    const ASSESS = "risk.v1.Risk/Assess";
    const c: Catalog = {
      ...estate([
        flow("a", [step("shop.oms", "risk", "rpc", { ref: ASSESS })]),
      ]),
      externals: [
        {
          id: "risk",
          slug: "risk",
          name: "Risk",
          summary: "",
          provides: [
            {
              id: "risk.v1.Risk",
              methods: [{ name: "Assess" }],
              source: "risk/openapi.yaml",
            },
          ],
        },
      ],
    };
    const { catalog, derived } = enrichCatalog(c);
    expect(serviceOf(catalog, "shop.oms").consumes).toMatchObject([
      { id: ASSESS, peer: "risk", status: "declared" },
    ]);
    expect(derived[0]).toMatchObject({
      kind: "rpc",
      peer: "risk",
      status: "declared",
    });
    expect(() => validateCatalog(catalog)).not.toThrow();
    // Declared, so not a problem: the far end is outside, and it is known.
    expect(problems(catalog)).toEqual([]);
  });

  it("marks a call to a peer that does not provide the method as unresolved", () => {
    // Somebody declared the call id, so the ref resolves; the step points it at
    // an external that provides nothing.
    const c = estate(
      [flow("a", [step("shop.oms", "risk", "rpc", { ref: METHOD })])],
      [
        oms(),
        pricing(),
        service("shop", "other", {
          consumes: [
            {
              id: METHOD,
              peer: "shop.pricing",
              status: "declared",
              source: "x",
            },
          ],
        }),
      ],
    );
    expect(
      serviceOf(enrichCatalog(c).catalog, "shop.oms").consumes,
    ).toMatchObject([{ id: METHOD, peer: "risk", status: "unresolved" }]);
  });

  it("lets a declared call win over the step", () => {
    const c = estate(
      [
        flow("a", [
          step("shop.oms", "shop.pricing", "rpc", {
            ref: METHOD,
            status: "verified",
          }),
        ]),
      ],
      [oms(), pricing()].map((s) =>
        s.id === "shop.oms"
          ? {
              ...s,
              consumes: [
                {
                  id: METHOD,
                  peer: "shop.pricing",
                  status: "declared",
                  source: "by hand",
                },
              ],
            }
          : s,
      ),
    );
    const { catalog, derived } = enrichCatalog(c);
    expect(derived).toEqual([]);
    expect(serviceOf(catalog, "shop.oms").consumes).toEqual([
      {
        id: METHOD,
        peer: "shop.pricing",
        status: "declared",
        source: "by hand",
      },
    ]);
  });

  it("ignores call steps", () => {
    const c = estate([
      flow("a", [step("shop.oms", "oms-db", "call", { ref: EVENT })]),
    ]);
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
        consumes: [
          { id: METHOD, peer: "shop.pricing", status: "declared", source: "x" },
        ],
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

describe("enrichCatalog: Redis store accesses", () => {
  it("joins a repository call to one concrete Redis key access", () => {
    const c = estate([
      flow("load-order", [
        step("shop.oms", "oms-db", "call", {
          label: "Get",
          storeAccess: { store: "shop.oms.redis", method: "Get" },
        }),
      ]),
    ]);
    c.stores = [
      {
        id: "shop.oms.redis",
        slug: "redis",
        name: "OMS Redis",
        kind: "redis",
        owner: "shop.oms",
        tables: [],
        keyspaces: [
          {
            pattern: "order:{id}",
            operations: ["read"],
            accesses: [
              {
                operation: "read",
                method: "Store.Get",
                source: "repository/redis.go:20",
              },
            ],
          },
        ],
      },
    ];

    const result = enrichCatalog(c).catalog;
    expect(walkSteps(result.flows[0]!.steps)[0]!.storeAccess).toEqual({
      store: "shop.oms.redis",
      method: "Get",
      operation: "read",
      keyspace: "order:{id}",
      source: "repository/redis.go:20",
    });
    expect(enrichCatalog(result).catalog).toBe(result);
  });

  it("leaves an ambiguous repository method unresolved", () => {
    const c = estate([
      flow("load-order", [
        step("shop.oms", "oms-db", "call", {
          storeAccess: { store: "shop.oms.redis", method: "Get" },
        }),
      ]),
    ]);
    c.stores = [
      {
        id: "shop.oms.redis",
        slug: "redis",
        name: "OMS Redis",
        kind: "redis",
        owner: "shop.oms",
        tables: [],
        keyspaces: ["order:{id}", "order-by-number:{number}"].map(
          (pattern) => ({
            pattern,
            operations: ["read" as const],
            accesses: [{ operation: "read" as const, method: "Store.Get" }],
          }),
        ),
      },
    ];

    expect(
      walkSteps(enrichCatalog(c).catalog.flows[0]!.steps)[0]!.storeAccess,
    ).toEqual({ store: "shop.oms.redis", method: "Get" });
  });
});

describe("enrichCatalog: the auth fragment", () => {
  // The three fragments together, the way the app reads them: the domain one
  // alone names endpoints the api one declares. A fragment carries no stamp
  // of its own (portolan.0010); the reader hands the history's over beside it.
  const raw = mergeCatalogs(
    ["domain", "api", "stores"].map((name) => ({
      path: `${name}.json`,
      stamp: { commit: "abc1234", generatedAt: "2026-09-05T00:00:00Z" },
      catalog: JSON.parse(
        readFileSync(
          new URL(`../examples/auth/portolan/${name}.json`, import.meta.url),
          "utf8",
        ),
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
    service.aggregates[0]!.events[0]!.wire = {
      name,
      channel: "shop.oms.order",
    };
    return service;
  }

  function stepOf(catalog: Catalog, slug: string) {
    const found = catalog.flows.find((f) => f.slug === slug)!;
    return found.steps[0] as Extract<FlowNode, { type: "step" }>;
  }

  it("resolves a step that names the wire name, and reads the consumer off it", () => {
    // What an extractor can say about somebody else's message: the name on it.
    const listens = flow("listens", [
      step("bus", "shop.pricing", "event", {
        status: "unresolved",
        label: "oms.OrderPlaced",
      }),
    ]);
    const { catalog } = enrichCatalog(estate([listens], [wired(), pricing()]));

    const resolved = stepOf(catalog, "listens");
    expect(resolved.ref).toBe(EVENT);
    expect(resolved.status).toBe("declared");
    expect(consumersOf(catalog)).toEqual([
      {
        service: "shop.pricing",
        status: "declared",
        via: { flow: "listens", step: "s1" },
      },
    ]);
  });

  it("resolves the last segment when one event travels under it", () => {
    const listens = flow("listens", [
      step("bus", "shop.pricing", "event", {
        status: "unresolved",
        label: "OrderPlaced",
      }),
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
              versions: [
                { version: "v1", doc: "", source: "x.java", fields: [] },
              ],
              consumers: [],
              wire: { name: "ledger.OrderPlaced" },
            },
          ],
        },
      ],
    });
    const listens = flow("listens", [
      step("bus", "shop.pricing", "event", {
        status: "unresolved",
        label: "OrderPlaced",
      }),
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
      step("bus", "shop.pricing", "event", {
        status: "unresolved",
        label: "nothing.AtAll",
      }),
    ]);
    const { catalog } = enrichCatalog(estate([both], [wired(), pricing()]));

    const steps = catalog.flows[0]!.steps as Extract<
      FlowNode,
      { type: "step" }
    >[];
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
            steps: [
              step("bus", "shop.pricing", "event", {
                status: "unresolved",
                label: "oms.OrderPlaced",
              }),
            ],
          },
          { title: "otherwise", steps: [] },
        ],
      },
    ]);
    const once = enrichCatalog(estate([nested], [wired(), pricing()])).catalog;
    const twice = enrichCatalog(once).catalog;

    const inside = (catalog: Catalog) =>
      (catalog.flows[0]!.steps[0] as Extract<FlowNode, { type: "alt" }>)
        .branches[0]!.steps[0] as Extract<FlowNode, { type: "step" }>;
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
              {
                name: "order_id",
                type: "text",
                nullable: false,
                fk: { table: "orders", column: "id" },
              },
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
    expect(keyOf(enrichCatalog(estateWithStores()).catalog)).toBe(
      "shop.oms.pg.orders",
    );
  });

  it("leaves a name two tables answer to alone", () => {
    const catalog = estateWithStores();
    catalog.stores!.push({
      id: "payments.ledger.pg",
      slug: "pg",
      name: "Ledger database",
      kind: "postgres",
      owner: "payments.ledger",
      tables: [
        { id: "payments.ledger.pg.orders", name: "orders", columns: [] },
      ],
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
