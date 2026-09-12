import { describe, expect, it } from "vitest";
import { buildIndex } from "../catalog";
import type { Catalog, Deployment } from "../catalog";
import { builtinProblems } from "./problem-rules";

const deployProblems = (catalog: Catalog) => builtinProblems(catalog, buildIndex(catalog), ["deployment-unclaimed", "deployment-drift"]);

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

const placed = (
  name: string,
  repo: string,
  path: string,
  extra: Partial<Deployment> = {},
): Deployment => ({
  id: `argocd/${name}`,
  name,
  project: "shop",
  environment: "prod",
  cluster: "in-cluster",
  namespace: "shop",
  repo,
  path,
  targetRevision: "main",
  revision: "a".repeat(40),
  tool: "kustomize",
  url: `https://argocd.example.com/applications/argocd/${name}`,
  ...extra,
});

const estate = (deployments: Deployment[]): Catalog => ({
  generatedAt: "",
  commit: "",
  contexts: [
    {
      id: "shop",
      slug: "shop",
      name: "Shop",
      summary: "",
      services: [service("shop.cart", "services/cart"), service("shop.oms", "")],
    },
  ],
  defs: {},
  flows: [],
  adrs: [],
  deployments,
});

describe("deployments the catalog cannot place", () => {
  it("is quiet when every Application deploys from a directory a service lives at", () => {
    const catalog = estate([
      placed("cart", "github.com/acme/shop", "services/cart/deploy"),
      // A service whose path is the whole repository claims any directory of it.
      placed("oms", "github.com/acme/shop", "anything/at/all"),
    ]);
    expect(deployProblems(catalog)).toEqual([]);
  });

  it("names the Application and where it deploys from, as a warning with no context", () => {
    const catalog = estate([
      placed("grafana", "github.com/acme/platform", "charts/grafana", {
        namespace: "monitoring",
      }),
    ]);
    const [problem, ...rest] = deployProblems(catalog);
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({
      rule: "deployment-unclaimed",
      severity: "warning",
      context: "",
      service: "",
      id: "argocd/grafana",
      peer: "github.com/acme/platform/charts/grafana",
    });
    expect(problem?.note).toContain("grafana runs in prod, namespace monitoring");
    expect(problem?.note).toContain("https://argocd.example.com/applications/argocd/grafana");
  });

  it("places by the labels when the Application carries them, and says so when they name nobody", () => {
    const placedByLabel = estate([
      placed("cart-prod", "github.com/acme/other", "envs/prod/shop/cart", { service: "shop.cart" }),
    ]);
    expect(deployProblems(placedByLabel)).toEqual([]);

    const nobody = estate([
      placed("grafana", "github.com/acme/platform", "charts/grafana", { service: "platform.grafana" }),
    ]);
    expect(deployProblems(nobody)[0]?.note).toContain("its labels name platform.grafana, which is no service of the estate");
  });

  it("reports drift on the service's row, in words, and stays quiet when the tree and the deployer agree", () => {
    const agreed = estate([placed("cart-prod", "github.com/acme/shop", "services/cart/deploy", { basis: "both" })]);
    expect(deployProblems(agreed)).toEqual([]);

    const drifted = estate([
      placed("cart-prod", "github.com/acme/shop", "services/cart/deploy", {
        basis: "both",
        images: ["ghcr.io/acme/cart:2.0.9"],
        drift: { targetRevision: "release-2.1", images: ["ghcr.io/acme/cart:2.1.0"] },
      }),
    ]);
    const [problem, ...rest] = deployProblems(drifted);
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ rule: "deployment-drift", severity: "warning", context: "shop", service: "shop.cart", id: "argocd/cart-prod", peer: "prod" });
    expect(problem?.note).toBe(
      "tracks release-2.1 in the tree, main deployed; pins ghcr.io/acme/cart:2.1.0 in the tree; running ghcr.io/acme/cart:2.0.9. https://argocd.example.com/applications/argocd/cart-prod",
    );
  });

  it("says the chart when the Application deploys one from a registry", () => {
    const catalog = estate([
      placed("redis", "charts.bitnami.com/bitnami", "", { chart: "redis" }),
    ]);
    expect(deployProblems(catalog)[0]?.peer).toBe("chart redis");
  });

  it("does not place a deployment on a service in another repository at the same path", () => {
    const catalog = estate([
      placed("cart", "github.com/acme/other", "services/cart/deploy"),
    ]);
    expect(deployProblems(catalog)).toHaveLength(1);
  });
});
