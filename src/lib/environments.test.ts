import { describe, expect, it } from "vitest";
import type { Catalog, Deployment } from "../catalog";
import { narrowToEnvironments, servicesDeployedIn } from "./environments";

const service = (id: string, path: string) => ({
  id,
  slug: id.split(".")[1] ?? id,
  name: id,
  repo: "github.com/acme/shop",
  path,
  readme: "",
  provides: [],
  consumes: [],
  aggregates: [],
});

const placed = (name: string, environment: string, path: string, extra: Partial<Deployment> = {}): Deployment => ({
  id: `argocd/${name}`,
  name,
  project: "shop",
  environment,
  cluster: "in-cluster",
  namespace: "shop",
  repo: "github.com/acme/shop",
  path,
  targetRevision: "main",
  revision: "a".repeat(40),
  tool: "kustomize",
  url: `https://argocd.example.com/applications/argocd/${name}`,
  ...extra,
});

const catalog: Catalog = {
  generatedAt: "",
  commit: "",
  contexts: [
    {
      id: "shop",
      slug: "shop",
      name: "Shop",
      summary: "",
      services: [service("shop.cart", "services/cart"), service("shop.oms", "services/oms")],
    },
    {
      id: "payments",
      slug: "payments",
      name: "Payments",
      summary: "",
      services: [service("payments.ledger", "services/ledger")],
    },
  ],
  defs: {},
  flows: [],
  adrs: [],
  deployments: [
    placed("cart", "prod", "services/cart/deploy"),
    placed("cart-staging", "staging", "services/cart/deploy"),
    placed("oms", "prod", "services/oms/deploy"),
    // No environment label and no cluster name: placed by the one word left.
    placed("ledger", "", "services/ledger/deploy", { cluster: "" }),
  ],
};

describe("the estate narrowed to an environment", () => {
  it("names the services the snapshot places in the environments asked for", () => {
    expect([...servicesDeployedIn(catalog, new Set(["prod"]))]).toEqual(["shop.cart", "shop.oms"]);
    expect([...servicesDeployedIn(catalog, new Set(["staging"]))]).toEqual(["shop.cart"]);
    expect([...servicesDeployedIn(catalog, new Set(["prod", "staging"]))]).toEqual(["shop.cart", "shop.oms"]);
    expect([...servicesDeployedIn(catalog, new Set(["unplaced"]))]).toEqual(["payments.ledger"]);
    expect(servicesDeployedIn(catalog, new Set(["nowhere"])).size).toBe(0);
  });

  it("keeps only the deployed services, drops a context left empty, and leaves the rest of the catalog alone", () => {
    const staging = narrowToEnvironments(catalog, new Set(["staging"]));
    expect(staging.contexts.map((c) => [c.id, c.services.map((s) => s.id)])).toEqual([["shop", ["shop.cart"]]]);
    expect(staging.deployments).toBe(catalog.deployments);
    expect(staging.flows).toBe(catalog.flows);
  });

  it("is the whole estate when no environment is chosen", () => {
    expect(narrowToEnvironments(catalog, new Set())).toBe(catalog);
  });
});
