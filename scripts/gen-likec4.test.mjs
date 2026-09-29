import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import { LikeC4 } from "likec4";

import { likec4Sources } from "./gen-likec4.mjs";

const generator = fileURLToPath(new URL("./gen-likec4.mjs", import.meta.url));
// Resolved like any import rather than at ./node_modules/.bin, which a git
// worktree sharing its parent checkout's node_modules does not have.
const likec4 = join(
  dirname(createRequire(import.meta.url).resolve("likec4/package.json")),
  "bin",
  "likec4.mjs",
);

/** Runs the generator over one catalog in a scratch tree, and validates what it wrote. */
function generate(catalog) {
  const root = mkdtempSync(join(tmpdir(), "portolan-likec4-"));
  mkdirSync(join(root, "data"));
  writeFileSync(
    join(root, "portolan.json"),
    JSON.stringify({ sources: ["data/*.json"] }),
  );
  writeFileSync(
    join(root, "data", "catalog.json"),
    JSON.stringify({
      generatedAt: "2026-09-06T00:00:00Z",
      commit: "0000000000000000000000000000000000000000",
      adrs: [],
      defs: {},
      ...catalog,
    }),
  );
  execFileSync(process.execPath, [generator], { cwd: root });
  execFileSync(process.execPath, [likec4, "validate", "likec4"], { cwd: root });
  return {
    spec: readFileSync(join(root, "likec4", "spec.c4"), "utf8"),
    model: readFileSync(join(root, "likec4", "model.c4"), "utf8"),
    views: readFileSync(join(root, "likec4", "views.c4"), "utf8"),
    deployment: readFileSync(join(root, "likec4", "deployment.c4"), "utf8"),
  };
}

describe("the LikeC4 generator as a step of gen", () => {
  it("hands back the four sources as files rather than writing them, so gen can settle them", async () => {
    const files = await likec4Sources({
      catalog: { generatedAt: "2026-09-06T00:00:00Z", commit: "0", adrs: [], defs: {}, contexts: [], flows: [] },
      manifest: { sources: ["data/*.json"] },
    });
    expect(files.map((file) => file.name)).toEqual(["deployment.c4", "spec.c4", "model.c4", "views.c4"]);
    expect(files.find((file) => file.name === "views.c4")?.contents).toContain("view landscape");
    expect(files.every((file) => file.contents.endsWith("\n"))).toBe(true);
  });
});

describe("the LikeC4 generator", () => {
  it("emits valid fallback views for an empty catalog", () => {
    const { model, views } = generate({ contexts: [], flows: [] });
    expect(model).toContain("model {");
    expect(views).toContain("view landscape");
    expect(views).toContain("view landscape_default");
    expect(views).toContain("view containers_default");
    expect(views).toContain("include *");
  });

  it("makes the implicit default profile include the complete catalog", () => {
    const { views } = generate({
      contexts: [
        {
          id: "platform",
          slug: "platform",
          name: "Platform",
          summary: "",
          services: [
            {
              id: "platform.api",
              slug: "api",
              name: "API",
              repo: "example/platform",
              path: "",
              readme: "",
              provides: [],
              consumes: [],
              aggregates: [],
            },
          ],
        },
      ],
      flows: [],
    });
    expect(views).toContain("view landscape_default");
    expect(views).toContain("include platform");
    expect(views).toContain("view containers_default");
    expect(views).toContain("include platform, platform.api");
  });

  it("keeps a contract request/response on one numbered relation", () => {
    const service = (slug, provides = []) => ({
      id: `demo.${slug}`,
      slug,
      name: slug,
      repo: "example/demo",
      path: slug,
      readme: "",
      provides,
      consumes: [],
      aggregates: [],
    });
    const { spec, views } = generate({
      contexts: [
        {
          id: "demo",
          slug: "demo",
          name: "Demo",
          summary: "",
          services: [
            service("api"),
            service("book", [
              {
                id: "book.v1.Book",
                source: "book.proto",
                methods: [
                  {
                    name: "Get",
                    request: "GetRequest",
                    response: "GetResponse",
                  },
                ],
              },
            ]),
          ],
        },
      ],
      flows: [
        {
          id: "flow.get-book",
          slug: "get-book",
          name: "Get book",
          summary: "",
          owner: "demo",
          participants: [
            { id: "demo.api", kind: "service", context: "demo" },
            { id: "demo.book", kind: "service", context: "demo" },
          ],
          steps: [
            {
              type: "step",
              id: "request",
              from: "demo.api",
              to: "demo.book",
              kind: "rpc",
              ref: "book.v1.Book/Get",
              label: "Get",
              status: "declared",
            },
            {
              type: "step",
              id: "response",
              from: "demo.book",
              to: "demo.api",
              kind: "response",
              label: "GetResponse",
              status: "declared",
              replyTo: "request",
            },
            {
              type: "step",
              id: "failure",
              from: "demo.book",
              to: "demo.api",
              kind: "response",
              label: "500 · Error",
              status: "declared",
              replyTo: "request",
              http: { status: 500, outcome: "error" },
            },
          ],
        },
        {
          id: "flow.get-book-contract",
          slug: "get-book-contract",
          name: "Get book contract",
          summary: "",
          owner: "demo",
          participants: [
            { id: "demo.api", kind: "service", context: "demo" },
            { id: "demo.book", kind: "service", context: "demo" },
          ],
          steps: [
            {
              type: "step",
              id: "request",
              from: "demo.api",
              to: "demo.book",
              kind: "rpc",
              ref: "book.v1.Book/Get",
              label: "Get",
              status: "declared",
            },
          ],
        },
      ],
    });

    expect(views).toContain(
      "demo.api -> demo.book 'GetRequest' {\n      color declared  line solid  head normal",
    );
    expect(views).toContain(
      "demo.book -> demo.api 'GetResponse' {\n      color declared  line dashed  head normal",
    );
    expect(views).toContain(
      "demo.book -> demo.api '500 · Error' {\n      color response_error  line dashed  head normal",
    );
    expect(spec).toContain("color response_error #b7646b");
    expect(views).toContain("GetRequest → GetResponse");
  });

  it("treats dots in a root participant id as data, not containment", () => {
    const { model, views } = generate({
      contexts: [
        {
          id: "demo",
          slug: "demo",
          name: "Demo",
          summary: "",
          services: [
            {
              id: "demo.app",
              slug: "app",
              name: "App",
              repo: "example/app",
              path: "",
              readme: "",
              provides: [],
              consumes: [],
              aggregates: [],
            },
          ],
        },
      ],
      flows: [
        {
          id: "flow.jobs",
          slug: "jobs",
          name: "Jobs",
          summary: "A queued job.",
          source: "jobs.go:1",
          owner: "demo",
          participants: [
            { id: "demo.app", kind: "service", context: "demo" },
            {
              id: "river.order-jobs",
              kind: "broker",
              context: null,
              label: "River orders",
            },
          ],
          steps: [
            {
              type: "step",
              id: "enqueue",
              from: "demo.app",
              to: "river.order-jobs",
              kind: "call",
              label: "enqueue",
              status: "declared",
            },
          ],
        },
      ],
    });
    expect(model).toContain("river_order_jobs = broker 'River orders'");
    expect(views).toContain("demo.app -> river_order_jobs 'enqueue'");
    expect(views).not.toContain("river.order_jobs");
  });

  it("routes a readable store lane through its canonical entityRef", () => {
    const service = {
      id: "demo.api",
      slug: "api",
      name: "API",
      repo: "example/demo",
      path: "api",
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
    };
    const { model, views } = generate({
      contexts: [{ id: "demo", slug: "demo", name: "Demo", summary: "", services: [service] }],
      stores: [{ id: "demo.api.pg", slug: "pg", name: "Postgres", kind: "postgres", owner: "demo.api", tables: [] }],
      flows: [{
        id: "flow.save",
        slug: "save",
        name: "Save",
        summary: "",
        owner: "demo",
        participants: [
          { id: "demo.api", kind: "service", context: "demo", entityRef: "demo.api" },
          { id: "database", kind: "store", context: "demo", entityRef: "demo.api.pg" },
        ],
        steps: [{ type: "step", id: "save", from: "demo.api", to: "database", kind: "call", label: "save", status: "declared" }],
      }],
    });
    expect(model).toContain("_store_demo_api_pg = store 'Postgres'");
    expect(model).toContain("database = store 'database'");
    expect(views).toContain("demo.api -> database 'save'");
  });

  it("draws L2 with leaf services, sibling stores and evidence-preserving edges", async () => {
    const service = (id, slug, name, extra) => ({
      id,
      slug,
      name,
      repo: "example/shop",
      path: slug,
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
      ...extra,
    });
    const { spec, model, views } = generate({
      contexts: [
        {
          id: "shop",
          slug: "shop",
          name: "Shop",
          summary: "",
          services: [
            service("shop.cart", "cart", "Cart", {
              technologies: ["Go"],
              provides: [
                {
                  id: "cart.v1",
                  source: "cart/openapi.yaml",
                  methods: [{ name: "getBasket" }, { name: "checkout" }],
                },
              ],
              aggregates: [
                {
                  id: "shop.cart.basket",
                  slug: "basket",
                  name: "Basket",
                  root: "Basket",
                  entities: [
                    {
                      id: "shop.cart.basket.basket",
                      slug: "basket",
                      name: "Basket",
                      fields: [{ name: "id", type: "string" }],
                    },
                  ],
                  valueObjects: [],
                  operations: [],
                  events: [
                    {
                      id: "shop.cart.basket.BasketCheckedOut",
                      slug: "basket-checked-out",
                      name: "BasketCheckedOut",
                      versions: [
                        {
                          version: "v1",
                          doc: "",
                          source: "cart.go:1",
                          fields: [],
                        },
                      ],
                      consumers: [{ service: "shop.oms", status: "declared" }],
                    },
                  ],
                },
              ],
            }),
            service("shop.oms", "oms", "Orders", {
              consumes: [
                {
                  id: "cart.v1/getBasket",
                  peer: "shop.cart",
                  status: "declared",
                  source: "oms/vendor/cart/openapi.yaml",
                },
                {
                  id: "cart.v1/checkout",
                  peer: "shop.cart",
                  status: "verified",
                  source: "oms/vendor/cart/openapi.yaml",
                },
              ],
            }),
          ],
        },
      ],
      stores: [
        {
          id: "shop.cart.pg",
          slug: "pg",
          name: "Cart database",
          kind: "postgres",
          owner: "shop.cart",
          tables: [],
        },
      ],
      flows: [
        {
          id: "flow.checkout",
          slug: "checkout",
          name: "Checkout",
          summary: "A basket becomes an order.",
          source: "checkout.go:1",
          owner: "shop",
          participants: [
            { id: "shop.cart", kind: "service", context: "shop" },
            { id: "bus", kind: "broker", context: null },
            { id: "shop.oms", kind: "service", context: "shop" },
          ],
          steps: [
            {
              type: "step",
              id: "s1",
              from: "shop.cart",
              to: "bus",
              kind: "event",
              label: "BasketCheckedOut",
              status: "verified",
            },
            {
              type: "step",
              id: "s2",
              from: "bus",
              to: "shop.oms",
              kind: "event",
              label: "BasketCheckedOut",
              status: "declared",
            },
          ],
        },
      ],
    });

    // What a box is built with and what it speaks, and what a store is.
    expect(model).toContain("technology 'Go · HTTP'");
    expect(model).toContain("technology 'postgres'");
    // Every relation says what kind of fact it is; a call carries its protocol.
    expect(model).toContain("shop.oms -[calls]-> shop.cart 'calls getBasket' {\n    technology 'HTTP'");
    expect(model).toContain(
      "shop.cart -[publishes_to]-> shop.oms 'publishes BasketCheckedOut'",
    );
    // The hop through the broker, once per direction, with the step's status.
    expect(model).toContain(
      "shop.cart -[bus]-> bus 'publishes BasketCheckedOut' {\n    style { color verified",
    );
    expect(model).toContain(
      "bus -[bus]-> shop.oms 'delivers BasketCheckedOut' {\n    style { color declared",
    );

    // The estate's containers: contexts opened, stores and the bus named.
    expect(views).toMatch(
      /view containers \{[^}]*include shop, shop\.cart, shop\.oms, shop\._store_shop_cart_pg, bus\n/,
    );
    // One edge per pair, counted, with the protocol and the best status.
    const pair =
      "include shop.oms -> shop.cart where kind is calls with { multiple true }";
    expect(views).toContain(`view containers {\n    title 'Containers'`);
    expect(views.split(pair)).toHaveLength(4); // containers, containers_default, and ctx_shop
    // With the bus on the picture the direct consumer arrow is not drawn twice.
    expect(views).toContain("include *, shop._store_shop_cart_pg");
    expect(views).toContain("exclude shop.cart -> shop.oms where kind is publishes_to");
    expect(model).toContain("shop.cart -[owns]-> shop._store_shop_cart_pg 'owns'");
    expect(views).toContain("autoLayout LeftRight 100 70");
    expect(views).toContain("include shop.cart with { description '' }");
    // The neighbours view keeps every method as its own relation: LikeC4
    // folds them, and the fold is only named, never regrouped.
    const neighbours = views.slice(views.indexOf("view svc_shop_oms of shop.oms {"));
    expect(neighbours).toMatch(/^view svc_shop_oms of shop\.oms \{\n    title[^\n]*\n    include \*, -> \*, \* ->\n/);
    // The service is spelled by its own name, a sibling from the root.
    expect(neighbours).toContain("    include oms -> shop.cart with { title 'calls 2 methods'  notes 'calls checkout\ncalls getBasket' }");
    expect(neighbours.slice(0, neighbours.indexOf("\n  }"))).not.toContain("multiple");
    const engine = await LikeC4.fromSource(spec + model + views, { logger: false });
    try {
      const computed = await engine.computedModel();
      for (const relation of Object.values(computed.$data.relations).filter((relation) => relation.kind === "calls")) {
        expect(relation.technology).toBe("HTTP");
        expect(relation.description.txt).toContain("oms/vendor/cart/openapi.yaml");
      }
      for (const id of ["containers", "containers_default", "ctx_shop"]) {
        const view = computed.view(id).$view;
        expect(view.nodes.find((node) => node.id === "shop.cart").children).toEqual([]);
        expect(view.nodes.find((node) => node.id === "shop._store_shop_cart_pg").parent).toBe("shop");
        expect(view.edges.filter((edge) => edge.source === "shop.oms" && edge.target === "shop.cart")).toHaveLength(2);
        expect(view.edges.some((edge) => edge.kind === "publishes_to")).toBe(false);
        expect(view.edges.filter((edge) => edge.kind === "bus")).toHaveLength(2);
      }
    } finally { await engine.dispose(); }
  });

  it("labels every arrow by what it does, and a folded one by what crosses", async () => {
    const service = (id, slug, extra) => ({
      id, slug, name: slug, repo: "example/demo", path: slug, readme: "",
      provides: [], consumes: [], aggregates: [], ...extra,
    });
    const { model, views, spec } = generate({
      contexts: [
        {
          id: "shop", slug: "shop", name: "Shop", summary: "",
          services: [service("shop.cart", "cart", {
            consumes: [
              { id: "ledger.v1/Charge", peer: "pay.ledger", status: "declared", source: "ledger.proto" },
              { id: "ledger.v1/Refund", peer: "pay.ledger", status: "declared", source: "ledger.proto" },
            ],
          })],
        },
        {
          id: "pay", slug: "pay", name: "Pay", summary: "",
          services: [service("pay.ledger", "ledger", {
            channels: [{ address: "pay.ledger.payment", protocol: "nats", messages: [] }],
            aggregates: [{
              id: "pay.ledger.payment", slug: "payment", name: "Payment", root: "Payment",
              entities: [{ id: "pay.ledger.payment.payment", slug: "payment", name: "Payment", fields: [{ name: "id", type: "string" }] }], valueObjects: [], operations: [],
              events: [{
                id: "pay.ledger.payment.PaymentCaptured", slug: "payment-captured", name: "PaymentCaptured",
                versions: [{ version: "v1", doc: "", source: "payment.go:2", fields: [] }],
                wire: { name: "ledger.PaymentCaptured", channel: "pay.ledger.payment" },
                consumers: [{ service: "shop.cart", status: "declared" }],
              }],
            }],
          })],
        },
      ],
      flows: [{
        id: "flow.mail", slug: "mail", name: "Mail", summary: "", source: "mail.go:1", owner: "pay",
        participants: [
          { id: "pay.ledger", kind: "service", context: "pay" },
          { id: "mailq", kind: "broker", context: null },
          { id: "bus", kind: "broker", context: null },
          { id: "shop.cart", kind: "service", context: "shop" },
        ],
        steps: [
          { type: "step", id: "s1", from: "pay.ledger", to: "mailq", kind: "call", label: "send_receipt", status: "declared",
            handoff: { kind: "job", transport: "celery", channel: "mail", message: "send_receipt", direction: "send" } },
          { type: "step", id: "s2", from: "mailq", to: "pay.ledger", kind: "call", label: "send_receipt", status: "declared",
            handoff: { kind: "job", transport: "celery", channel: "mail", message: "send_receipt", direction: "receive" } },
          { type: "step", id: "s3", from: "pay.ledger", to: "bus", kind: "event", label: "PaymentCaptured", status: "declared" },
          { type: "step", id: "s4", from: "bus", to: "shop.cart", kind: "event", label: "PaymentCaptured", status: "declared" },
        ],
      }],
    });

    // One relation reads the way its arrow points.
    expect(model).toContain("shop.cart -[calls]-> pay.ledger 'calls Charge'");
    expect(model).toContain("pay.ledger -[publishes_to]-> shop.cart 'publishes PaymentCaptured'");
    // A job is sent onto the queue and delivered off it, and keeps a head.
    expect(model).toContain("pay.ledger -[bus]-> mailq 'enqueues send_receipt' {\n    technology 'Celery'\n    style { color declared  line dashed  head onormal }");
    expect(model).toContain("mailq -[bus]-> pay.ledger 'delivers send_receipt' {\n    technology 'Celery'\n    style { color declared  line dashed  head onormal }");
    // An event says what it travels on through its wire channel's protocol,
    // both onto the bus and off it; the broker is what its hops travel on.
    expect(model).toContain("pay.ledger -[bus]-> bus 'publishes PaymentCaptured' {\n    technology 'NATS'");
    expect(model).toContain("bus -[bus]-> shop.cart 'delivers PaymentCaptured' {\n    technology 'NATS'");
    expect(model).toContain("  bus = broker 'bus' {\n    technology 'NATS'\n  }");
    expect(model).toContain("  mailq = broker 'mailq' {\n    technology 'Celery'\n  }");
    // Between two contexts, the fold says what crosses rather than `[...]`.
    expect(views).toContain("include shop -> pay with { title 'calls 2 methods'  notes 'calls Charge\ncalls Refund' }");
    expect(views).toContain("include pay -> shop with { title 'publishes PaymentCaptured'");

    const engine = await LikeC4.fromSource(spec + model + views, { logger: false });
    try {
      const computed = await engine.computedModel();
      const landscape = computed.view("landscape").$view;
      const label = (from, to) => landscape.edges.find((edge) => edge.source === from && edge.target === to)?.label;
      expect(label("shop", "pay")).toBe("calls 2 methods");
      expect(label("pay", "shop")).toBe("publishes PaymentCaptured");
      // The container view relabels a bus hop; its technology stays.
      const containers = computed.view("containers").$view;
      const hop = containers.edges.find((edge) => edge.source === "pay.ledger" && edge.target === "bus");
      expect([hop?.label, hop?.technology]).toEqual(["publishes PaymentCaptured", "NATS"]);
      expect(containers.nodes.find((node) => node.id === "bus")?.technology).toBe("NATS");
    } finally { await engine.dispose(); }
  });

  it("labels a service's own folded arrows in its neighbours view, spelled the way the scope reads them", async () => {
    const service = (id, slug, consumes = []) => ({
      id, slug, name: slug, repo: "example/demo", path: slug, readme: "",
      provides: [], consumes, aggregates: [],
    });
    const call = (peer, method) => ({ id: `${peer}.v1/${method}`, peer, status: "declared", source: "api.proto" });
    const { spec, model, views } = generate({
      contexts: [
        // The service is named like its context: inside `view … of auth.auth`
        // the name `auth.auth` would mean `auth.auth.auth`.
        { id: "auth", slug: "auth", name: "Auth", summary: "", services: [
          service("auth.auth", "auth", [call("shop.oms", "GetOrder"), call("shop.oms", "ListOrders")]),
        ] },
        { id: "shop", slug: "shop", name: "Shop", summary: "", services: [
          service("shop.cart", "cart", [call("auth.auth", "Login"), call("auth.auth", "Logout")]),
          service("shop.oms", "oms"),
        ] },
      ],
      stores: [{ id: "auth.auth.pg", slug: "pg", name: "Auth database", kind: "postgres", owner: "auth.auth", tables: [] }],
      flows: [],
    });
    expect(views).toContain("    include auth -> shop with { title 'calls 2 methods'  notes 'calls GetOrder\ncalls ListOrders' }");
    expect(views).toContain("    include shop -> auth with { title 'calls 2 methods'  notes 'calls Login\ncalls Logout' }");

    const engine = await LikeC4.fromSource(spec + model + views, { logger: false });
    try {
      const view = (await engine.computedModel()).view("svc_auth_auth").$view;
      // The labels name boxes the view already draws; they add none.
      expect(view.nodes.map((node) => node.id).sort()).toEqual(["auth._store_auth_auth_pg", "auth.auth", "shop"]);
      const labels = Object.fromEntries(view.edges.map((edge) => [`${edge.source} -> ${edge.target}`, edge.label]));
      expect(labels).toEqual({
        "auth.auth -> shop": "calls 2 methods",
        "shop -> auth.auth": "calls 2 methods",
        "auth.auth -> auth._store_auth_auth_pg": "owns",
      });
    } finally { await engine.dispose(); }
  });

  it("names a broker's transport only when every hop through it agrees", () => {
    const service = (id, slug) => ({
      id, slug, name: slug, repo: "example/demo", path: slug, readme: "",
      provides: [], consumes: [], aggregates: [],
    });
    const hop = (id, from, to, transport) => ({
      type: "step", id, from, to, kind: "call", label: `run_${id}`, status: "declared",
      handoff: { kind: "job", transport, channel: "work", message: `run_${id}`, direction: from === "bus" ? "receive" : "send" },
    });
    const { model } = generate({
      contexts: [{ id: "demo", slug: "demo", name: "Demo", summary: "", services: [service("demo.a", "a"), service("demo.b", "b")] }],
      flows: [{
        id: "flow.jobs", slug: "jobs", name: "Jobs", summary: "", source: "jobs.go:1", owner: "demo",
        participants: [
          { id: "demo.a", kind: "service", context: "demo" },
          { id: "demo.b", kind: "service", context: "demo" },
          { id: "bus", kind: "broker", context: null },
        ],
        steps: [hop("s1", "demo.a", "bus", "nats"), hop("s2", "demo.b", "bus", "rabbitmq")],
      }],
    });
    expect(model).toContain("demo.a -[bus]-> bus 'enqueues run_s1' {\n    technology 'NATS'");
    expect(model).toContain("demo.b -[bus]-> bus 'enqueues run_s2' {\n    technology 'RabbitMQ'");
    expect(model).toContain("  bus = broker 'bus'\n");
  });

  it("places every deployed service in its environment, cluster and namespace, and draws the frames by name", () => {
    const service = (slug, path) => ({
      id: `shop.${slug}`,
      slug,
      name: slug,
      repo: "github.com/acme/shop",
      path,
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
    });
    const placed = (name, environment, cluster, namespace, path) => ({
      id: `argocd/${name}`,
      name,
      project: "shop",
      environment,
      cluster,
      namespace,
      repo: "github.com/acme/shop",
      path,
      targetRevision: "main",
      revision: "a".repeat(40),
      tool: "kustomize",
      url: `https://argocd.example.com/applications/argocd/${name}`,
    });
    const { spec, deployment, views } = generate({
      contexts: [
        {
          id: "shop",
          slug: "shop",
          name: "Shop",
          summary: "",
          services: [service("cart", "services/cart"), service("oms", "services/oms")],
        },
      ],
      flows: [],
      deployments: [
        placed("cart", "prod", "in-cluster", "shop", "services/cart/deploy"),
        placed("cart-staging", "staging", "staging-eu", "shop", "services/cart/deploy"),
        placed("oms", "prod", "in-cluster", "shop", "services/oms/deploy"),
        // Deploys a repository nobody in the estate claims: placed nowhere.
        placed("grafana", "prod", "in-cluster", "monitoring", "charts/grafana"),
      ],
    });
    expect(spec).toContain("deploymentNode environment");
    expect(deployment).toContain(
      "  environment prod 'prod' {\n" +
        "    cluster in_cluster 'in-cluster' {\n" +
        "      namespace shop 'shop' {\n" +
        "        shop_cart = instanceOf shop.cart {\n" +
        "          description 'cart at aaaaaaa'\n" +
        "        }\n" +
        "        shop_oms = instanceOf shop.oms {",
    );
    expect(deployment).toContain("environment staging 'staging'");
    expect(deployment).not.toContain("grafana");
    expect(deployment).not.toContain("monitoring");
    // The environment view names every frame under it; a descendant wildcard
    // would fold the cluster and the namespace away.
    expect(views).toContain(
      "  deployment view deploy_prod {\n" +
        "    title 'prod — deployed'\n" +
        "    include prod.in_cluster, prod.in_cluster.shop, prod.in_cluster.shop.shop_cart, prod.in_cluster.shop.shop_oms\n" +
        "  }",
    );
    expect(views).toContain(
      "  deployment view deploy_svc_shop_cart {\n" +
        "    title 'cart — where it runs'\n" +
        "    include prod, prod.in_cluster, prod.in_cluster.shop, prod.in_cluster.shop.shop_cart, staging, staging.staging_eu, staging.staging_eu.shop, staging.staging_eu.shop.shop_cart\n" +
        "  }",
    );
    expect(views).not.toContain("deploy_svc_shop_grafana");
  });

  it("writes an empty deployment file and no deployment view when nothing is placed", () => {
    const { deployment, views } = generate({ contexts: [], flows: [] });
    expect(deployment.trim()).toBe("// GENERATED — do not edit.");
    expect(views).not.toContain("deployment view");
  });
});
