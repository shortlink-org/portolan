// The cluster reader, against a recorded kubectl. NEVER against a live one.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_OUT, OFFLINE_ENV, fragment, labelsOf, run } from "./fetch-k8s.mjs";
import { hostOnly, topology } from "./k8s-topology.mjs";

const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-k8s-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const workload = (kind, name, namespace, labels, containers, extra = {}) => ({
  kind,
  apiVersion: kind === "CronJob" || kind === "Job" ? "batch/v1" : "apps/v1",
  metadata: { name, namespace, labels },
  spec: kind === "CronJob"
    ? { schedule: "0 3 * * *", jobTemplate: { spec: { template: { metadata: { labels }, spec: { containers } } } } }
    : { selector: { matchLabels: labels }, template: { metadata: { labels }, spec: { containers } }, ...extra },
});

const service = (name, namespace, selector) => ({ kind: "Service", apiVersion: "v1", metadata: { name, namespace }, spec: { selector, ports: [{ port: 8080 }] } });

// The recorded cluster. Every value that must never reach the fragment is
// planted here and grepped for below.
const OBJECTS = [
  workload("Deployment", "pricing", "shop", { "app.kubernetes.io/name": "pricing", "app.kubernetes.io/part-of": "shop" }, [{
    name: "pricing",
    image: "ghcr.io/acme/pricing:1.4.2",
    env: [
      { name: "CART_URL", value: "http://cart.shop.svc:8080/api" },
      { name: "LEDGER_DSN", value: "postgres://pricing:hunter2@ledger-db.payments.svc:5432/ledger?sslmode=disable" },
      { name: "LOG_LEVEL", value: "info" },
      { name: "DB_PASSWORD", value: "s3cr3t-password" },
      { name: "AUTH_URL", value: "http://auth:9000" },
      { name: "OMS_URL", valueFrom: { configMapKeyRef: { name: "pricing-config", key: "OMS_URL" } } },
      { name: "API_TOKEN", valueFrom: { secretKeyRef: { name: "pricing-secrets", key: "token" } } },
    ],
    envFrom: [{ configMapRef: { name: "pricing-shared" } }, { secretRef: { name: "pricing-secrets" } }],
  }]),
  workload("CronJob", "nightly-reprice", "shop", { "app.kubernetes.io/name": "pricing", "app.kubernetes.io/part-of": "shop" }, [{
    name: "reprice",
    env: [{ name: "PRICING_URL", value: "http://pricing.shop.svc" }, { name: "OMS_URL", value: "grpc://oms.shop.svc:9090" }],
  }]),
  workload("Deployment", "cart", "shop", { app: "cart", team: "checkout" }, [{ name: "cart", env: [{ name: "PRICING_ADDR", value: "pricing.shop.svc:9090" }] }]),
  workload("Deployment", "orphan", "sandbox", { app: "orphan" }, [{ name: "orphan" }]),
  workload("Job", "migrate", "payments", { "app.kubernetes.io/name": "ledger", "app.kubernetes.io/part-of": "payments" }, [{ name: "migrate", env: [{ name: "DATABASE_URL", value: "postgres://u:p@ledger-db.payments.svc/x" }] }]),
  service("pricing", "shop", { "app.kubernetes.io/name": "pricing" }),
  service("auth", "shop", { app: "auth" }),
  service("cart", "shop", { app: "cart" }),
  service("ledger-db", "payments", { app: "ledger-db" }),
  {
    kind: "Ingress", apiVersion: "networking.k8s.io/v1", metadata: { name: "shop", namespace: "shop" },
    spec: { rules: [
      { host: "shop.example.com", http: { paths: [{ path: "/pricing", backend: { service: { name: "pricing" } } }, { path: "/cart", backend: { service: { name: "cart" } } }] } },
      { host: "admin.example.com", http: { paths: [{ path: "/", backend: { service: { name: "auth" } } }] } },
    ] },
  },
  { kind: "ConfigMap", apiVersion: "v1", metadata: { name: "pricing-config", namespace: "shop" }, data: { OMS_URL: "grpc://oms.shop.svc:9090", GREETING: "hello" } },
  { kind: "ConfigMap", apiVersion: "v1", metadata: { name: "pricing-shared", namespace: "shop" }, data: { CATALOG_URL: "https://catalog.shop.svc.cluster.local/v1", REGION: "eu-west-1" } },
];

const ROUTES = [{
  kind: "HTTPRoute", apiVersion: "gateway.networking.k8s.io/v1", metadata: { name: "pricing", namespace: "shop" },
  spec: { hostnames: ["api.example.com"], rules: [{ backendRefs: [{ name: "pricing" }] }] },
}];

const PLANTED = [
  "hunter2", "s3cr3t", "pricing-secrets", "8080", "9090", "/api", "sslmode", "u:p@",
  "CART_URL", "LEDGER_DSN", "OMS_URL", "DB_PASSWORD", "LOG_LEVEL", "info", "hello", "eu-west-1", "ghcr.io",
];

/** A kubectl that answers from the recording, by namespace, and knows no Gateway API. */
function recorded({ routes = true, fail = false, calls = [] } = {}) {
  return (args) => {
    calls.push(args);
    if (fail) {
      const cause = new Error("kubectl failed");
      cause.status = 1;
      cause.stderr = "Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout";
      throw cause;
    }
    const kinds = args[args.indexOf("get") + 1];
    const scoped = args.includes("-n") ? args[args.indexOf("-n") + 1] : "";
    const pool = kinds.startsWith("httproutes") || kinds.startsWith("grpcroutes")
      ? (routes ? (kinds.startsWith("httproutes") ? ROUTES : []) : null)
      : OBJECTS;
    if (pool === null) {
      const cause = new Error("kubectl failed");
      cause.status = 1;
      cause.stderr = `error: the server doesn't have a resource type "${kinds.split(".")[0]}"`;
      throw cause;
    }
    return JSON.stringify({ kind: "List", items: pool.filter((item) => !scoped || item.metadata.namespace === scoped) });
  };
}

const isolated = { [OFFLINE_ENV]: "", CI: "" };
const read = (options, io = {}) => {
  const said = [];
  const response = run({ options }, { env: { ...isolated, ...(io.env ?? {}) }, exec: io.exec ?? recorded(), stderr: (text) => said.push(text) });
  const file = response.files.find((f) => f.name === (options.out ?? DEFAULT_OUT));
  return { response, file, catalog: file ? JSON.parse(file.contents) : undefined, said, warnings: response.warnings.map((w) => `${w.ref ? `${w.ref}: ` : ""}${w.message}`) };
};
const serviceOf = (catalog, id) => catalog.contexts.flatMap((c) => c.services).find((s) => s.id === id);

describe("fetch-k8s", () => {
  it("reads hosts and dials per service, by the recommended labels, and nothing else", () => {
    const { catalog, response, warnings, said } = read({ cache: cache(), namespaceContexts: { shop: "shop" } });

    expect(catalog.contexts.map((c) => c.id)).toEqual(["payments", "shop"]);
    const pricing = serviceOf(catalog, "shop.pricing");
    expect(pricing.hosts).toEqual(["api.example.com", "pricing", "pricing.shop", "pricing.shop.svc", "pricing.shop.svc.cluster.local", "shop.example.com"]);
    expect(pricing.dials).toEqual(["auth", "cart.shop.svc", "catalog.shop.svc.cluster.local", "ledger-db.payments.svc", "oms.shop.svc"]);
    // A Deployment beside the CronJob: the service is not a job.
    expect(pricing.kind).toBeUndefined();

    const cart = serviceOf(catalog, "shop.cart");
    expect(cart.slug).toBe("cart");
    expect(cart.dials).toEqual(["pricing.shop.svc"]);
    expect(cart.hosts).toContain("shop.example.com");

    const ledger = serviceOf(catalog, "payments.ledger");
    expect(ledger.kind).toBe("job");
    expect(ledger.dials).toEqual(["ledger-db.payments.svc"]);

    expect(warnings).toEqual(['sandbox: 1 workload(s) carry no "app.kubernetes.io/part-of" label and the namespace is not in namespaceContexts; they were left out']);
    expect(said).toEqual([]);

    const everything = response.files.map((f) => f.contents).join("\n") + warnings.join("\n");
    for (const planted of PLANTED) expect(everything, planted).not.toContain(planted);
    expect(everything).not.toContain("Secret");
  });

  it("asks for no secrets, and asks once per namespace when namespaces are named", () => {
    const calls = [];
    read({ cache: cache(), namespaces: ["shop", "auth"], kubeContext: "prod" }, { exec: recorded({ calls }) });
    for (const args of calls) {
      expect(args.slice(0, 2)).toEqual(["--context", "prod"]);
      expect(args.join(" ")).not.toMatch(/secret/i);
    }
    const scopes = calls.map((args) => args[args.indexOf("-n") + 1]);
    expect(scopes.filter((ns) => ns === "auth").length).toBe(3);
    expect(scopes.filter((ns) => ns === "shop").length).toBe(3);
    expect(calls.some((args) => args.includes("-A"))).toBe(false);
  });

  it("lets the manifest name its own labels", () => {
    const { catalog, warnings } = read({ cache: cache(), labels: { context: "team", service: "app" } });
    expect(warnings).toEqual([
      'payments: 1 workload(s) carry no "team" label and the namespace is not in namespaceContexts; they were left out',
      'sandbox: 1 workload(s) carry no "team" label and the namespace is not in namespaceContexts; they were left out',
      'shop: 2 workload(s) carry no "team" label and the namespace is not in namespaceContexts; they were left out',
    ]);
    expect(catalog.contexts.map((c) => c.id)).toEqual(["checkout"]);
    expect(serviceOf(catalog, "checkout.cart").dials).toEqual(["pricing.shop.svc"]);
    expect(labelsOf({ labels: { context: " " } })).toEqual({ context: "app.kubernetes.io/part-of", service: "app.kubernetes.io/name" });
  });

  it("goes on without Gateway API routes, with one warning", () => {
    const { catalog, warnings } = read({ cache: cache() }, { exec: recorded({ routes: false }) });
    expect(serviceOf(catalog, "shop.pricing").hosts).not.toContain("api.example.com");
    expect(warnings).toContain("the cluster serves no Gateway API routes, or refused to list them; hosts of HTTPRoute and GRPCRoute were not read");
  });

  it("replays the committed fragment offline, unchanged", () => {
    const dir = cache();
    const first = read({ cache: dir });
    writeFileSync(join(dir, DEFAULT_OUT), first.file.contents);

    const replayed = read({ cache: dir }, { env: { [OFFLINE_ENV]: "1" }, exec: () => { throw new Error("must not be called"); } });
    expect(replayed.file.contents).toBe(first.file.contents);
    expect(replayed.warnings).toEqual(["the cluster was not read (offline); the fragment committed in this repository is used unchanged"]);

    const inCI = read({ cache: dir }, { env: { CI: "true" }, exec: () => { throw new Error("must not be called"); } });
    expect(inCI.file.contents).toBe(first.file.contents);
  });

  it("falls back to the committed fragment when the cluster cannot be reached, and keeps the server out of the report", () => {
    const dir = cache();
    const first = read({ cache: dir });
    writeFileSync(join(dir, DEFAULT_OUT), first.file.contents);

    const { file, warnings, said } = read({ cache: dir }, { exec: recorded({ fail: true }) });
    expect(file.contents).toBe(first.file.contents);
    expect(warnings).toEqual(["the cluster was not read (kubectl get deployments,statefulsets,daemonsets,replicasets,jobs,cronjobs,services,ingresses,configmaps: exit 1); the fragment committed in this repository is used unchanged"]);
    expect(warnings.join("\n")).not.toContain("10.0.0.1");
    expect(said.join("\n")).toContain("10.0.0.1:6443");
  });

  it("is an error, never a short answer, with no cluster and no committed copy", () => {
    expect(() => read({ cache: cache() }, { exec: recorded({ fail: true }) })).toThrow(/could not be read .* no usable fragment/);
    expect(() => read({ cache: cache() }, { env: { [OFFLINE_ENV]: "1" } })).toThrow(/no usable fragment|no k8s-cluster.json/);
    expect(() => run({ options: {} }, { env: isolated })).toThrow(/no cache directory/);
  });

  it("writes the fragment the same way whatever order the cluster listed things in", () => {
    const shuffled = [...OBJECTS].reverse();
    const exec = (args) => {
      const kinds = args[args.indexOf("get") + 1];
      if (kinds.startsWith("httproutes")) return JSON.stringify({ items: ROUTES });
      if (kinds.startsWith("grpcroutes")) return JSON.stringify({ items: [] });
      return JSON.stringify({ items: shuffled });
    };
    expect(read({ cache: cache() }, { exec }).file.contents).toBe(read({ cache: cache() }).file.contents);
  });
});

describe("k8s-topology", () => {
  // The same table as extract-k8s's TestHostOnly, so the two readers stay
  // one rule.
  it("hostOnly keeps a host and nothing else", () => {
    const known = new Set(["auth", "auth.shop"]);
    const cases = {
      "http://cart.shop.svc:8080/api": "cart.shop.svc",
      "postgres://u:p@db.payments.svc:5432/x?sslmode=off": "db.payments.svc",
      "HTTPS://Cart.Shop.SVC.cluster.local": "cart.shop.svc.cluster.local",
      "auth:9000": "auth",
      "auth.shop": "auth.shop",
      "oms.shop.svc.cluster.local": "oms.shop.svc.cluster.local",
      cart: undefined,
      "example.com": undefined,
      "https://api.stripe.com/v1": undefined,
      hunter2: undefined,
      true: undefined,
      info: undefined,
      "host=db.shop.svc user=x password=y": undefined,
      "": undefined,
      "-bad.shop.svc": undefined,
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc": undefined,
    };
    for (const [value, want] of Object.entries(cases)) expect(hostOnly(value, known), value).toBe(want);
  });

  it("an empty selector selects nothing, and a Service in another namespace never does", () => {
    const objects = [
      workload("Deployment", "a", "one", { app: "a" }, [{ name: "a" }]),
      service("headless", "one", {}),
      service("a", "two", { app: "a" }),
    ];
    expect(topology(objects)[0].hosts).toEqual([]);
  });

  it("fragment leaves a service its kind when only jobs deploy it", () => {
    const only = [workload("CronJob", "sweep", "ops", { "app.kubernetes.io/name": "sweeper", "app.kubernetes.io/part-of": "ops" }, [{ name: "s" }])];
    const warnings = [];
    const out = JSON.parse(fragment(only, {}, { warn: (ref, message) => warnings.push(message) }));
    expect(out.contexts[0].services[0]).toEqual({ id: "ops.sweeper", slug: "sweeper", name: "", repo: "", path: "", readme: "", provides: [], consumes: [], aggregates: [], kind: "job" });
    expect(warnings).toEqual([]);
  });
});
