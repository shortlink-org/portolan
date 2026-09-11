import { describe, expect, it } from "vitest";
import type { Deployment } from "./catalog";
import { mergeCatalogs } from "./merge";
import type { CatalogSource } from "./merge";

function source(path: string, deployments: Deployment[]): CatalogSource {
  return {
    path,
    catalog: {
      generatedAt: "",
      commit: "",
      contexts: [],
      defs: {},
      flows: [],
      adrs: [],
      deployments,
    },
  };
}

const manifest = (over: Partial<Deployment> = {}): Deployment => ({
  id: "argocd/shop-cart-prod",
  name: "shop-cart-prod",
  project: "shop",
  environment: "prod",
  cluster: "in-cluster",
  namespace: "shop",
  repo: "github.com/acme/gitops",
  path: "envs/prod/shop/cart",
  targetRevision: "main",
  revision: "",
  tool: "kustomize",
  url: "",
  service: "shop.cart",
  images: ["ghcr.io/acme/cart:2.1.0"],
  basis: "manifest",
  ...over,
});

const api = (over: Partial<Deployment> = {}): Deployment => ({
  id: "argocd/shop-cart-prod",
  name: "shop-cart-prod",
  project: "shop",
  environment: "prod",
  cluster: "in-cluster",
  namespace: "shop",
  repo: "github.com/acme/gitops",
  path: "envs/prod/shop/cart",
  targetRevision: "main",
  revision: "a".repeat(40),
  tool: "kustomize",
  url: "https://argocd.example.com/applications/argocd/shop-cart-prod",
  images: ["ghcr.io/acme/cart:2.1.0", "redis:7"],
  basis: "api",
  ...over,
});

describe("the merge lays the tree under the deployer", () => {
  it("folds a manifest row and an api row into one that the deployer shapes and the tree fills, with no drift when they agree", () => {
    const { catalog, conflicts } = mergeCatalogs([
      source("gitops/portolan/argocd.json", [manifest()]),
      source("argocd/argocd.apps.json", [api({ service: undefined })]),
    ]);
    expect(conflicts).toEqual([]);
    expect(catalog.deployments).toHaveLength(1);
    const [row] = catalog.deployments!;
    expect(row).toMatchObject({
      basis: "both",
      revision: "a".repeat(40),
      url: "https://argocd.example.com/applications/argocd/shop-cart-prod",
      // The labels the tree carries place the row when the deployer's did not.
      service: "shop.cart",
      // What runs, not what is pinned: the base's redis is running too.
      images: ["ghcr.io/acme/cart:2.1.0", "redis:7"],
    });
    expect(row?.drift).toBeUndefined();
  });

  it("keeps the tree's word as drift where the deployer says otherwise, whichever arrives first", () => {
    const tree = manifest({ targetRevision: "release-2.1", images: ["ghcr.io/acme/cart:2.1.0"], namespace: "shop" });
    const cluster = api({ targetRevision: "main", images: ["ghcr.io/acme/cart:2.0.9"], namespace: "shop-old" });
    for (const order of [[tree, cluster], [cluster, tree]]) {
      const { catalog, conflicts } = mergeCatalogs([
        source("first.json", [order[0]!]),
        source("second.json", [order[1]!]),
      ]);
      expect(conflicts).toEqual([]);
      const [row] = catalog.deployments!;
      expect(row?.basis).toBe("both");
      expect(row?.targetRevision).toBe("main");
      expect(row?.namespace).toBe("shop-old");
      expect(row?.drift).toEqual({
        namespace: "shop",
        targetRevision: "release-2.1",
        images: ["ghcr.io/acme/cart:2.1.0"],
      });
    }
  });

  it("does not call a pinned image drift when nothing runs yet, and shows the pinned ones instead", () => {
    const { catalog } = mergeCatalogs([
      source("tree.json", [manifest()]),
      source("api.json", [api({ images: undefined, revision: "" })]),
    ]);
    const [row] = catalog.deployments!;
    expect(row?.images).toEqual(["ghcr.io/acme/cart:2.1.0"]);
    expect(row?.drift).toBeUndefined();
  });

  it("leaves a row only one source spoke for as it was, and reports two of one basis as a collision", () => {
    // Sources are read in path order, so the names say who comes first.
    const { catalog, conflicts } = mergeCatalogs([
      source("a-tree.json", [manifest()]),
      source("b-tree.json", [manifest({ path: "elsewhere" })]),
      source("c-api.json", [api()]),
      source("d-api.json", [api({ revision: "b".repeat(40) })]),
    ]);
    expect(catalog.deployments).toHaveLength(1);
    expect(catalog.deployments?.[0]?.revision).toBe("a".repeat(40));
    expect(conflicts.map((c) => c.path)).toEqual(["b-tree.json", "d-api.json"]);
    expect(conflicts[0]?.message).toContain("declared here and in a-tree.json");
    expect(conflicts[1]?.message).toContain("listed here and in c-api.json");

    const alone = mergeCatalogs([source("tree.json", [manifest()])]);
    expect(alone.catalog.deployments?.[0]).toEqual(manifest());
  });
});
