import { describe, expect, it } from "vitest";
import type { BoundedContext, Catalog } from "./catalog";
import { mergeCatalogs } from "./merge";
import type { CatalogSource } from "./merge";

function source(path: string, catalog: Partial<Catalog>): CatalogSource {
  return {
    path,
    catalog: {
      generatedAt: "2026-01-01T00:00:00Z",
      commit: "aaa1111",
      contexts: [],
      defs: {},
      flows: [],
      adrs: [],
      ...catalog,
    },
  };
}

function context(
  id: string,
  services: string[],
  overrides: Partial<BoundedContext> = {},
): BoundedContext {
  return {
    id,
    slug: id,
    name: id,
    summary: "",
    services: services.map((serviceId) => ({
      id: serviceId,
      slug: serviceId.split(".")[1] ?? serviceId,
      name: serviceId,
      repo: "",
      path: "",
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
    })),
    ...overrides,
  };
}

describe("mergeCatalogs", () => {
  it("puts services from two sources into the context they share", () => {
    const merged = mergeCatalogs([
      source("a.json", { contexts: [context("shop", ["shop.oms"])] }),
      source("b.json", { contexts: [context("shop", ["shop.pricing"])] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.catalog.contexts).toHaveLength(1);
    expect(merged.catalog.contexts[0]?.services.map((s) => s.id)).toEqual([
      "shop.oms",
      "shop.pricing",
    ]);
  });

  // The set of sources comes from a glob, and a glob's order is not a fact
  // about the estate. Two runs that disagree would make every generated file
  // churn for no reason.
  it("does not depend on the order the sources arrive in", () => {
    const a = source("a.json", { contexts: [context("shop", ["shop.oms"])] });
    const b = source("b.json", { contexts: [context("shop", ["shop.pricing"])] });

    expect(JSON.stringify(mergeCatalogs([a, b]).catalog)).toEqual(
      JSON.stringify(mergeCatalogs([b, a]).catalog),
    );
  });

  // A fragment that knows only one aspect leaves the rest empty, and sorts
  // wherever its filename puts it. An empty value must never win.
  it("lets a later source fill in what an earlier one left empty", () => {
    const bare = context("auth", ["auth.auth"], { name: "", summary: "" });
    bare.services = bare.services.map((s) => ({ ...s, name: "", repo: "" }));

    const full = context("auth", ["auth.auth"], { name: "Authentication" });
    full.services = full.services.map((s) => ({
      ...s,
      name: "Authentication & Sessions",
      repo: "github.com/example/auth",
    }));

    const merged = mergeCatalogs([
      source("a-api.json", { contexts: [bare] }),
      source("b-domain.json", { contexts: [full] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.catalog.contexts[0]?.name).toBe("Authentication");
    expect(merged.catalog.contexts[0]?.services[0]?.name).toBe("Authentication & Sessions");
  });

  it("records two sources disagreeing about a context's name, and keeps the first", () => {
    const merged = mergeCatalogs([
      source("a.json", { contexts: [context("shop", [], { name: "Shop" })] }),
      source("b.json", { contexts: [context("shop", [], { name: "Storefront" })] }),
    ]);

    expect(merged.catalog.contexts[0]?.name).toBe("Shop");
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.path).toBe("b.json");
    expect(merged.conflicts[0]?.message).toContain("Storefront");
  });

  // The reason each aspect of a service gets its own extractor: one source
  // knows the aggregates, another knows what the service answers over HTTP, and
  // neither has to know the other exists.
  it("merges one service described by two sources", () => {
    const domain = context("auth", ["auth.auth"]);
    domain.services = domain.services.map((s) => ({
      ...s,
      aggregates: [
        { id: "auth.auth.user", slug: "user", name: "User", readme: "", root: "User", entities: [], valueObjects: [], operations: [], events: [] },
      ],
    }));

    const api = context("auth", ["auth.auth"]);
    api.services = api.services.map((s) => ({
      ...s,
      provides: [{ id: "auth.v1.Users", methods: ["registerUser"], source: "openapi.yaml" }],
    }));

    const merged = mergeCatalogs([
      source("a-domain.json", { contexts: [domain] }),
      source("b-api.json", { contexts: [api] }),
    ]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.catalog.contexts[0]?.services).toHaveLength(1);

    const service = merged.catalog.contexts[0]?.services[0];
    expect(service?.aggregates.map((a) => a.id)).toEqual(["auth.auth.user"]);
    expect(service?.provides.map((p) => p.id)).toEqual(["auth.v1.Users"]);
  });

  it("reports two sources disagreeing about a service's repo", () => {
    const a = context("auth", ["auth.auth"]);
    a.services = a.services.map((s) => ({ ...s, repo: "github.com/one" }));
    const b = context("auth", ["auth.auth"]);
    b.services = b.services.map((s) => ({ ...s, repo: "github.com/two" }));

    const merged = mergeCatalogs([
      source("a.json", { contexts: [a] }),
      source("b.json", { contexts: [b] }),
    ]);

    expect(merged.catalog.contexts[0]?.services[0]?.repo).toBe("github.com/one");
    expect(merged.conflicts[0]?.message).toContain("different repo");
  });

  it("accepts a shared type defined identically twice", () => {
    const money = { fields: [{ name: "amount", type: "int64", doc: "" }] };
    const merged = mergeCatalogs([
      source("a.json", { defs: { Money: money } }),
      source("b.json", { defs: { Money: money } }),
    ]);

    expect(merged.conflicts).toEqual([]);
  });

  // `ref` is a bare key into one namespace, so two sources meaning different
  // things by "Money" is a real problem rather than a naming accident.
  it("reports a shared type defined differently in two sources", () => {
    const merged = mergeCatalogs([
      source("a.json", { defs: { Money: { fields: [{ name: "amount", type: "int64", doc: "" }] } } }),
      source("b.json", { defs: { Money: { fields: [{ name: "amount", type: "string", doc: "" }] } } }),
    ]);

    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.where).toBe("defs.Money");
    expect(merged.catalog.defs.Money?.fields[0]?.type).toBe("int64");
  });

  it("keeps one flow when two sources declare the same id, and says so", () => {
    const flow = {
      id: "flow.checkout",
      slug: "checkout",
      name: "Checkout",
      summary: "",
      provenance: "authored" as const,
      participants: [],
      steps: [],
    };

    const merged = mergeCatalogs([
      source("a.json", { flows: [flow] }),
      source("b.json", { flows: [{ ...flow, name: "Checkout again" }] }),
    ]);

    expect(merged.catalog.flows).toHaveLength(1);
    expect(merged.catalog.flows[0]?.name).toBe("Checkout");
    expect(merged.conflicts[0]?.message).toContain("already declared in a.json");
  });

  // A merged catalog is exactly as fresh as its stalest part, and the parts
  // keep their own stamps so anything that wants to be precise still can be.
  it("stamps the merge with the oldest source and keeps each source's own", () => {
    const merged = mergeCatalogs([
      source("a.json", { generatedAt: "2026-03-01T00:00:00Z", commit: "aaa" }),
      source("b.json", { generatedAt: "2026-01-01T00:00:00Z", commit: "bbb" }),
    ]);

    expect(merged.catalog.generatedAt).toBe("2026-01-01T00:00:00Z");
    expect(merged.catalog.commit).toBe("2 sources");
    expect(merged.sources).toEqual([
      { path: "a.json", generatedAt: "2026-03-01T00:00:00Z", commit: "aaa" },
      { path: "b.json", generatedAt: "2026-01-01T00:00:00Z", commit: "bbb" },
    ]);
  });

  it("keeps a single commit when every source agrees", () => {
    const merged = mergeCatalogs([
      source("a.json", { commit: "same" }),
      source("b.json", { commit: "same" }),
    ]);

    expect(merged.catalog.commit).toBe("same");
  });
});
