import { describe, expect, it, vi } from "vitest";

import { applyPlan, edgeBatches, validatePlan } from "./dx-apply.mjs";

const plan = {
  version: 1,
  entities: [
    { identifier: "shop.cart", type: "service", name: "Cart" },
    { identifier: "shop.pricing", type: "service", name: "Pricing" },
  ],
  relationEdges: [{ relation_identifier: "service-depends-on-service", edges: { "shop.cart": ["shop.pricing"] } }],
};

describe("DX apply plan", () => {
  it("validates references", () => {
    expect(() => validatePlan(plan)).not.toThrow();
    expect(() => validatePlan({ ...plan, relationEdges: [{ relation_identifier: "depends", edges: { "shop.cart": ["missing"] } }] })).toThrow(/outside the plan/);
  });

  it("does not need a token or make requests in dry-run mode", async () => {
    const fetch = vi.fn();
    expect(await applyPlan(plan, { token: "", fetch, dryRun: true })).toEqual({ entities: 2, edges: 1, requests: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("upserts entities before relation edges", async () => {
    const paths = [];
    const fetch = vi.fn(async (url) => { paths.push(new URL(url).pathname); return new Response('{"ok":true}'); });
    const result = await applyPlan(plan, { token: "secret", fetch });
    expect(result.requests).toBe(3);
    expect(paths).toEqual(["/catalog.entities.upsert", "/catalog.entities.upsert", "/catalog.relationEdges.bulkUpsert"]);
  });

  it("batches at the DX limit", () => {
    const edges = { a: Array.from({ length: 101 }, (_, index) => `b${index}`) };
    expect(edgeBatches(edges, 100)).toHaveLength(2);
  });
});
