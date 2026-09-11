import { describe, expect, it } from "vitest";
import type { Catalog, Deployment } from "../catalog";
import { deployProblems } from "./deploy-problems";

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
      kind: "deployment-unclaimed",
      severity: "warning",
      context: "",
      service: "",
      id: "argocd/grafana",
      peer: "github.com/acme/platform/charts/grafana",
    });
    expect(problem?.note).toContain("grafana runs in prod, namespace monitoring");
    expect(problem?.note).toContain("https://argocd.example.com/applications/argocd/grafana");
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
