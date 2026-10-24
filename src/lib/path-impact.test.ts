import { describe, expect, it } from "vitest";
import type { Catalog, Service } from "../catalog";
import { resolvePathImpact } from "./path-impact";

const service = (id: string, repo: string, path: string): Service => ({
  id,
  slug: id.split(".").at(-1)!,
  name: id,
  repo,
  path,
  readme: "",
  provides: [],
  consumes: [],
  aggregates: [],
});

const catalog = (services: Service[]): Catalog => ({
  generatedAt: "",
  commit: "",
  contexts: [{ id: "shop", slug: "shop", name: "Shop", summary: "", services }],
  defs: {},
  flows: [],
  adrs: [],
});

describe("changed path impact", () => {
  it("chooses the longest owning service path in the same repository", () => {
    const found = resolvePathImpact(catalog([
      service("shop.root", "github.com/acme/shop", ""),
      service("shop.checkout", "https://github.com/acme/shop.git", "services/checkout"),
      service("shop.api", "github.com/acme/shop", "services/checkout/api"),
      service("other.api", "github.com/acme/other", "services/checkout/api"),
    ]), "git@github.com:acme/shop.git", ["services/checkout/api/routes.ts"]);

    expect(found).toEqual([{
      path: "services/checkout/api/routes.ts",
      repository: "git@github.com:acme/shop.git",
      level: "service",
      service: "shop.api",
      servicePath: "services/checkout/api",
    }]);
  });

  it("keeps equal longest owners at repository level as ambiguous", () => {
    const found = resolvePathImpact(catalog([
      service("shop.api", "github.com/acme/shop", "services/api"),
      service("shop.worker", "github.com/acme/shop", "services/api"),
    ]), "github.com/acme/shop", ["services/api/main.ts"]);

    expect(found).toEqual([{
      path: "services/api/main.ts",
      repository: "github.com/acme/shop",
      level: "repository",
      reason: "ambiguous",
      candidates: ["shop.api", "shop.worker"],
      servicePath: "services/api",
    }]);
  });

  it("keeps unmatched paths at repository level and never crosses repositories", () => {
    const found = resolvePathImpact(catalog([
      service("other.api", "github.com/acme/other", "services/api"),
    ]), "github.com/acme/shop", ["README.md", "services/api/main.ts"]);

    expect(found).toEqual([
      { path: "README.md", repository: "github.com/acme/shop", level: "repository", reason: "unmatched" },
      { path: "services/api/main.ts", repository: "github.com/acme/shop", level: "repository", reason: "unmatched" },
    ]);
  });

  it("normalizes, deduplicates and sorts paths deterministically", () => {
    const found = resolvePathImpact(catalog([
      service("shop.root", "github.com/acme/shop", "."),
    ]), "github.com/acme/shop", ["z.ts", "./a.ts", "z.ts"]);

    expect(found.map((impact) => impact.path)).toEqual(["a.ts", "z.ts"]);
    expect(found.every((impact) => impact.level === "service" && impact.service === "shop.root")).toBe(true);
  });
});
