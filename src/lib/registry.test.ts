import { describe, expect, it } from "vitest";
import { buildIndex, validateCatalog, type Catalog } from "../catalog";
import { registryCatalog } from "./scenarios";
import {
  callsThrough,
  consumersOf,
  countsOf,
  dependenciesOf,
  dependentsOf,
  interfacesOf,
  matchModules,
  moduleBySlug,
  modules,
  packageOf,
  packagesOf,
  registryUrl,
  servicesUsing,
} from "./registry";

const catalog = registryCatalog();
const index = buildIndex(catalog);

function shop() {
  const module = modules(catalog).find((m) => m.id === "buf.build/acme/shop");
  if (!module) throw new Error("no shop module");

  return module;
}

function huge() {
  const module = modules(catalog).find((m) => m.id === "buf.build/acme/huge");
  if (!module) throw new Error("no huge module");

  return module;
}

/** A catalog that never published a proto — the state the estate is in today. */
const bare: Catalog = {
  generatedAt: "2026-01-01T00:00:00Z",
  commit: "0000000",
  contexts: [],
  defs: {},
  flows: [],
  adrs: [],
};

describe("the scenario itself", () => {
  it("is a catalog the validator accepts", () => {
    expect(() => validateCatalog(catalog)).not.toThrow();
  });
});

describe("modules", () => {
  it("finds a module by the slug the URL uses", () => {
    expect(moduleBySlug(index, "acme-shop")?.id).toBe("buf.build/acme/shop");
    expect(moduleBySlug(index, "nothing")).toBeUndefined();
  });

  it("links a module to a registry, at the commit it was built from", () => {
    expect(registryUrl(shop())).toBe(
      "https://buf.build/acme/shop/tree/c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
    );
  });

  // A module never published to a registry has nowhere to link to, and a
  // dead link would be worse than none.
  it("has no link for a module that was never published", () => {
    expect(
      registryUrl({ ...shop(), registry: undefined, commit: undefined }),
    ).toBeNull();
  });
});

describe("what a module holds", () => {
  it("finds the interfaces declared in it, with the service answering on each", () => {
    const declared = interfacesOf(index, shop());

    expect(declared.map((d) => d.provided.id)).toEqual([
      "shop.v1.Orders",
      "shop.events.v1.Feed",
    ]);
    expect(declared[0]?.service.id).toBe("shop.oms");
  });

  it("groups interfaces by the proto package they sit in", () => {
    const packages = packagesOf(index, shop());

    expect(packages.map((p) => p.name)).toEqual(["shop.v1", "shop.events.v1"]);
    expect(packages[0]?.interfaces.map((i) => i.provided.id)).toEqual([
      "shop.v1.Orders",
    ]);
  });

  // A module is not only the interfaces in it: a package holding nothing but
  // messages is still part of what was published.
  it("keeps a package the inventory lists but no interface sits in", () => {
    const module = { ...shop(), packages: ["shop.v1", "shop.types.v1"] };
    const packages = packagesOf(index, module);

    expect(packages.map((p) => p.name)).toContain("shop.types.v1");
    expect(
      packages.find((p) => p.name === "shop.types.v1")?.interfaces,
    ).toEqual([]);
  });

  it("counts a message moved by two interfaces once", () => {
    const counts = countsOf(index, shop());

    // Both interfaces list Message1..N, so the union is smaller than the sum.
    const declared = interfacesOf(index, shop());
    const total = declared.reduce(
      (n, d) => n + (d.provided.messages?.length ?? 0),
      0,
    );
    expect(counts.messages).toBeLessThan(total);
    expect(counts.interfaces).toBe(2);
    expect(counts.methods).toBe(8);
    expect(counts.packages).toBe(2);
  });

  it("reads the package out of an interface id", () => {
    expect(packageOf("shop.v1.Orders")).toBe("shop.v1");
    expect(packageOf("Orders")).toBe("");
  });
});

describe("who uses a module", () => {
  it("finds a service through what it publishes and what it calls", () => {
    expect(servicesUsing(index, huge()).map((s) => s.id)).toEqual([
      "shop.oms",
      "shop.pricing",
    ]);
  });

  // A service that both publishes and calls is one user, not two.
  it("does not count one service twice", () => {
    const ids = servicesUsing(index, shop()).map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // The interesting fact about a module is who ELSE reads it, so its own
  // publisher is not listed among its consumers.
  it("leaves the owner out of the consumers", () => {
    expect(consumersOf(index, shop()).map((s) => s.id)).not.toContain(
      "shop.oms",
    );
  });

  it("finds the calls made through a module's vendored copies", () => {
    const calls = callsThrough(catalog, huge());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.call.id).toBe("huge.v1.Svc1/Method1");
    expect(calls[0]?.service.id).toBe("shop.oms");
  });
});

describe("dependencies", () => {
  it("resolves a dep the catalog holds and names one it does not", () => {
    const deps = dependenciesOf(index, shop());

    expect(deps.map((d) => d.id)).toEqual([
      "buf.build/acme/huge",
      "buf.build/other/never-vendored",
    ]);
    expect(deps[0]?.module?.slug).toBe("acme-huge");
    // Dangling is normal: a module may depend on one the estate never vendored.
    expect(deps[1]?.module).toBeUndefined();
  });

  it("finds the modules that depend on this one", () => {
    expect(dependentsOf(catalog, huge()).map((m) => m.id)).toEqual([
      "buf.build/acme/shop",
    ]);
    expect(dependentsOf(catalog, shop())).toEqual([]);
  });
});

describe("matching, for the sidebar", () => {
  const hitting =
    (needle: string) =>
    (...fields: string[]) =>
      fields.some((f) => f.toLowerCase().includes(needle));

  it("keeps every package when the module itself matched", () => {
    const found = matchModules(modules(catalog), hitting("acme/shop"));

    expect(found).toHaveLength(1);
    expect(found[0]?.packages).toEqual(shop().packages);
  });

  it("keeps only the packages that matched otherwise", () => {
    const found = matchModules(modules(catalog), hitting("shop.events"));

    expect(found).toHaveLength(1);
    expect(found[0]?.packages).toEqual(["shop.events.v1"]);
  });

  it("finds nothing when nothing matches", () => {
    expect(matchModules(modules(catalog), hitting("zzz"))).toEqual([]);
  });
});

// THE REQUIREMENT THE WHOLE FEATURE HAS TO MEET BEFORE IT HAS ANY DATA.
//
// An estate that has never published a proto must render exactly as it did
// before, with no empty sections and no dead rows.
describe("a catalog with no modules at all", () => {
  const empty = buildIndex(bare);
  const nothing = {
    id: "buf.build/acme/nothing",
    slug: "nothing",
    name: "acme/nothing",
    packages: [],
    files: [],
    source: "",
  };

  it("has no modules to list", () => {
    expect(modules(bare)).toEqual([]);
    expect(moduleBySlug(empty, "anything")).toBeUndefined();
  });

  it("answers empty for every lookup rather than throwing", () => {
    expect(interfacesOf(empty, nothing)).toEqual([]);
    expect(servicesUsing(empty, nothing)).toEqual([]);
    expect(consumersOf(empty, nothing)).toEqual([]);
    expect(dependenciesOf(empty, nothing)).toEqual([]);
    expect(dependentsOf(bare, nothing)).toEqual([]);
    expect(callsThrough(bare, nothing)).toEqual([]);
    expect(packagesOf(empty, nothing)).toEqual([]);
    expect(matchModules([], () => true)).toEqual([]);
  });

  it("counts nothing", () => {
    expect(countsOf(empty, nothing)).toEqual({
      packages: 0,
      interfaces: 0,
      methods: 0,
      messages: 0,
      deps: 0,
      consumers: 0,
    });
  });
});
