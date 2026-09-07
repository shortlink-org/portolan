import { describe, expect, it } from "vitest";

import type { Catalog } from "./catalog";
import {
  catalogProfileNamed,
  filterCatalogForProfile,
  globToRegExp,
} from "./catalog-profile";

describe("catalog profiles", () => {
  it("selects a named profile and falls back to the declared default", () => {
    const manifest = {
      defaultCatalog: "avia",
      catalogs: [
        { id: "example", title: "Example", sources: ["examples/**/*.json"], contexts: ["shop"], projects: [] },
        { id: "avia", title: "Avia", sources: ["external/repos/avia/**/*.json"], contexts: ["avia"], projects: [] },
      ],
    };
    expect(catalogProfileNamed(manifest, "example").id).toBe("example");
    expect(catalogProfileNamed(manifest, "missing").id).toBe("avia");
  });

  it("matches one and two-star source globs", () => {
    expect(globToRegExp("examples/*/portolan/*.json").test("examples/auth/portolan/api.json")).toBe(true);
    expect(globToRegExp("examples/*/portolan/*.json").test("examples/shop/cart/portolan/api.json")).toBe(false);
    expect(globToRegExp("external/repos/avia/**/portolan/*.json").test("external/repos/avia/core/portolan/api.json")).toBe(true);
  });

  it("removes foreign contexts and their profile-owned facts", () => {
    const catalog = {
      generatedAt: "",
      commit: "",
      defs: {},
      contexts: [
        { id: "avia", slug: "avia", name: "Avia", summary: "", services: [{ id: "avia.core", slug: "core", name: "Core", repo: "", path: "", readme: "", provides: [], consumes: [], aggregates: [] }] },
        { id: "shop", slug: "shop", name: "Shop", summary: "", services: [{ id: "shop.cart", slug: "cart", name: "Cart", repo: "", path: "", readme: "", provides: [], consumes: [], aggregates: [] }] },
      ],
      flows: [
        { id: "flow.avia", slug: "avia", name: "Avia", summary: "", owner: "avia", participants: [], steps: [] },
        { id: "flow.shop", slug: "shop", name: "Shop", summary: "", owner: "shop", participants: [], steps: [] },
      ],
      adrs: [],
      stores: [
        { id: "avia.core.redis", slug: "redis", name: "Redis", kind: "redis", owner: "avia.core", tables: [] },
        { id: "shop.cart.pg", slug: "pg", name: "PG", kind: "postgres", owner: "shop.cart", tables: [] },
      ],
    } satisfies Catalog;
    const filtered = filterCatalogForProfile(catalog, {
      id: "avia",
      title: "Avia",
      sources: [],
      contexts: ["avia"],
      projects: [],
    });
    expect(filtered.contexts.map((context) => context.id)).toEqual(["avia"]);
    expect(filtered.flows.map((flow) => flow.id)).toEqual(["flow.avia"]);
    expect(filtered.stores?.map((store) => store.id)).toEqual(["avia.core.redis"]);
  });
});
