import { describe, expect, it } from "vitest";
import type { Catalog, Service } from "../catalog";
import { catalog } from "../testing/estate";
import { BROKER_SHARE, bridges, centrality, serviceGraph } from "./centrality";

// A catalog reduced to what the graph reads: contexts, services and the
// calls between them. `a -> b` is a call from a to b; the graph does not
// care which way, only that the two are joined.
function estate(
  contexts: Record<string, string[]>,
  edges: string[],
  consumers: Record<string, string[]> = {},
): Catalog {
  const service = (context: string, slug: string): Service => {
    const id = `${context}.${slug}`;
    return {
      id,
      slug,
      name: slug,
      repo: "",
      path: "",
      readme: "",
      provides: [],
      consumes: edges
        .filter((e) => e.startsWith(`${id} -> `))
        .map((e) => ({
          id: `rpc/${e}`,
          peer: e.slice(id.length + 4),
          status: "verified" as const,
          source: "test",
        })),
      aggregates:
        consumers[id] === undefined
          ? []
          : [
              {
                id: `${id}.root`,
                slug: "root",
                name: "root",
                readme: "",
                root: "root",
                entities: [],
                valueObjects: [],
                operations: [],
                events: [
                  {
                    id: `${id}.root.Happened`,
                    slug: "happened",
                    name: "Happened",
                    versions: [],
                    consumers: (consumers[id] ?? []).map((s) => ({
                      service: s,
                      status: "verified" as const,
                    })),
                  },
                ],
              },
            ],
    };
  };
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    commit: "0000000",
    contexts: Object.entries(contexts).map(([id, slugs]) => ({
      id,
      slug: id,
      name: id,
      summary: "",
      services: slugs.map((slug) => service(id, slug)),
    })),
    defs: {},
    flows: [],
    adrs: [],
  };
}

const by = <T extends { id: string }>(list: T[], id: string): T =>
  list.find((c) => c.id === id) ?? expect.fail(`no ${id}`);

describe("serviceGraph", () => {
  it("joins a pair once whatever joins them, and both ways", () => {
    const graph = serviceGraph(
      estate({ a: ["x", "y"] }, ["a.x -> a.y", "a.y -> a.x"], {
        "a.x": ["a.y"],
      }),
    );
    expect(graph.adjacent.get("a.x")).toEqual(["a.y"]);
    expect(graph.adjacent.get("a.y")).toEqual(["a.x"]);
  });

  it("leaves out ghosts, unresolved peers and a service consuming itself", () => {
    const graph = serviceGraph(
      estate({ a: ["x"] }, ["a.x -> fraud-scoring", "a.x -> a.x"], {
        "a.x": ["analytics-sink", "a.x"],
      }),
    );
    expect(graph.adjacent.get("a.x")).toEqual([]);
    expect(graph.nodes).toEqual(["a.x"]);
  });
});

describe("centrality", () => {
  it("is zero everywhere on an estate too small to have a middle", () => {
    const two = centrality(estate({ a: ["x", "y"] }, ["a.x -> a.y"]));
    expect(two.map((c) => c.betweenness)).toEqual([0, 0]);
    expect(two.map((c) => c.degree)).toEqual([1, 1]);
  });

  it("puts the whole of a path through its middle and none through its ends", () => {
    // x - y - z: the only pair not touching y is none, so y carries 1 of 1.
    const path = centrality(
      estate({ a: ["x", "y", "z"] }, ["a.x -> a.y", "a.y -> a.z"]),
    );
    expect(by(path, "a.y").betweenness).toBe(1);
    expect(by(path, "a.x").betweenness).toBe(0);
    expect(by(path, "a.z").betweenness).toBe(0);
  });

  it("gives a star's hub everything and its leaves nothing", () => {
    const star = centrality(
      estate({ a: ["hub", "p", "q", "r"] }, [
        "a.p -> a.hub",
        "a.q -> a.hub",
        "a.r -> a.hub",
      ]),
    );
    expect(by(star, "a.hub").betweenness).toBe(1);
    expect(by(star, "a.hub").degree).toBe(3);
    expect(by(star, "a.p").betweenness).toBe(0);
  });

  it("splits a pair's paths between two equal roads", () => {
    // x - y - z and x - w - z: y and w each carry half of the one pair.
    const square = centrality(
      estate({ a: ["x", "y", "w", "z"] }, [
        "a.x -> a.y",
        "a.x -> a.w",
        "a.y -> a.z",
        "a.w -> a.z",
      ]),
    );
    // Three pairs not touching y: (x,z) half through y, (x,w) and (w,z) not.
    expect(by(square, "a.y").betweenness).toBeCloseTo(0.5 / 3);
    expect(by(square, "a.w").betweenness).toBeCloseTo(0.5 / 3);
  });

  it("names the context pairs a service is the road between", () => {
    // auth.a - shop.gw - shop.core - pay.p: the gateway is the only road
    // from auth to shop and to pay; core is the only road to pay from both.
    const c = centrality(
      estate({ auth: ["a"], shop: ["gw", "core"], pay: ["p"] }, [
        "auth.a -> shop.gw",
        "shop.gw -> shop.core",
        "shop.core -> pay.p",
      ]),
    );
    expect(by(c, "shop.gw").between).toEqual([
      { a: "auth", b: "shop", share: 1 },
      { a: "auth", b: "pay", share: 1 },
    ]);
    expect(by(c, "shop.core").between).toEqual([
      { a: "auth", b: "pay", share: 1 },
      { a: "shop", b: "pay", share: 1 },
    ]);
    expect(by(c, "auth.a").between).toEqual([]);
    expect(by(c, "pay.p").between).toEqual([]);
  });

  it("does not call a service the road between two contexts when there is another as good", () => {
    // auth.a reaches pay.p through shop.x or shop.y: each carries exactly
    // half, and half is not more than half, so neither stands between.
    const even = centrality(
      estate({ auth: ["a"], shop: ["x", "y"], pay: ["p"] }, [
        "auth.a -> shop.x",
        "auth.a -> shop.y",
        "shop.x -> pay.p",
        "shop.y -> pay.p",
      ]),
    );
    expect(by(even, "shop.x").between).toEqual([]);
    expect(by(even, "shop.y").between).toEqual([]);
    expect(by(even, "shop.x").betweenness).toBeGreaterThan(0);
    // A second auth service that reaches pay only through x tilts it: x now
    // carries (1 + 0.5) of the 2 pairs, y carries 0.5 of them.
    const tilted = centrality(
      estate({ auth: ["a1", "a2"], shop: ["x", "y"], pay: ["p"] }, [
        "auth.a1 -> shop.x",
        "auth.a1 -> shop.y",
        "auth.a2 -> shop.x",
        "shop.x -> pay.p",
        "shop.y -> pay.p",
      ]),
    );
    expect(by(tilted, "shop.x").between).toEqual([
      { a: "auth", b: "pay", share: 0.75 },
    ]);
    expect(by(tilted, "shop.y").between).toEqual([]);
    expect(BROKER_SHARE).toBe(0.5);
  });

  it("does not count the roads a service is at the end of as roads it is between", () => {
    // auth.a - shop.gw - shop.core: (a, gw) is a road gw is ON. Between
    // auth and shop, gw carries the one remaining pair (a, core) in full.
    const c = centrality(
      estate({ auth: ["a"], shop: ["gw", "core"] }, [
        "auth.a -> shop.gw",
        "shop.gw -> shop.core",
      ]),
    );
    expect(by(c, "shop.gw").between).toEqual([{ a: "auth", b: "shop", share: 1 }]);
  });
});

describe("bridges", () => {
  it("lists the estate's roads between contexts, widest first", () => {
    // In the frozen estate auth reaches everything through cart, and cart
    // reaches everything but auth through pricing; oms is the only way from
    // shop and auth into payments and delivery.
    const list = bridges(catalog);
    expect(list.map((b) => b.id)).toEqual([
      "shop.oms",
      "shop.pricing",
      "shop.cart",
    ]);
    expect(by(list, "shop.cart").between).toEqual([
      { a: "shop", b: "auth", share: 1 },
      { a: "payments", b: "auth", share: 1 },
      { a: "delivery", b: "auth", share: 1 },
    ]);
    expect(by(list, "shop.oms").between.map((p) => `${p.a}~${p.b}`)).toEqual([
      "shop~payments",
      "shop~delivery",
      "payments~auth",
      "delivery~auth",
    ]);
    for (const b of list) {
      expect(b.betweenness).toBeGreaterThan(0);
      expect(b.betweenness).toBeLessThanOrEqual(1);
    }
    expect(list.map((b) => b.betweenness)).toEqual(
      [...list.map((b) => b.betweenness)].sort((x, y) => y - x),
    );
  });

  it("leaves a leaf out however many neighbours it has", () => {
    const star = bridges(
      estate({ a: ["hub"], b: ["p"], c: ["q"] }, ["b.p -> a.hub", "c.q -> a.hub"]),
    );
    expect(star.map((b) => b.id)).toEqual(["a.hub"]);
  });
});
