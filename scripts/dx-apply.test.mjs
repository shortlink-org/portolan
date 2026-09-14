import { describe, expect, it, vi } from "vitest";

import { applyPlan, edgeBatches, preflightPlan, validatePlan } from "./dx-apply.mjs";

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
    const fetch = vi.fn(async (url, init) => {
      const path = new URL(url).pathname;
      paths.push(`${init.method} ${path}`);
      if (path === "/catalog.entityTypes.info") {
        return json({ ok: true, entity_type: { identifier: "service", properties: [] } });
      }
      if (path === "/catalog.relations.info") {
        return json({
          ok: true,
          relation: {
            identifier: "service-depends-on-service",
            source_entity_type_identifier: "service",
            target_entity_type_identifier: "service",
          },
        });
      }
      return json({ ok: true });
    });
    const result = await applyPlan(plan, { token: "secret", fetch });
    expect(result.requests).toBe(3);
    expect(result.checks).toBe(2);
    expect(paths).toEqual([
      "GET /catalog.entityTypes.info",
      "GET /catalog.relations.info",
      "POST /catalog.entities.upsert",
      "POST /catalog.entities.upsert",
      "POST /catalog.relationEdges.bulkUpsert",
    ]);
  });

  it("rejects a missing property before the first write", async () => {
    const withProperty = structuredClone(plan);
    withProperty.entities[0].properties = { language: ["TypeScript"] };
    const fetch = vi.fn(async () => json({
      ok: true,
      entity_type: { identifier: "service", properties: [] },
    }));

    await expect(applyPlan(withProperty, { token: "secret", fetch })).rejects.toThrow(
      /property language does not exist on entity type service/,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("rejects a relation whose endpoint types do not match the plan", async () => {
    const fetch = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path === "/catalog.entityTypes.info") {
        return json({ ok: true, entity_type: { identifier: "service", properties: [] } });
      }
      return json({
        ok: true,
        relation: {
          identifier: "service-depends-on-service",
          source_entity_type_identifier: "application",
          target_entity_type_identifier: "service",
        },
      });
    });

    await expect(preflightPlan(plan, { token: "secret", fetch })).rejects.toThrow(
      /expects source type application, but shop.cart has type service/,
    );
  });

  it("batches at the DX limit", () => {
    const edges = { a: Array.from({ length: 101 }, (_, index) => `b${index}`) };
    expect(edgeBatches(edges, 100)).toHaveLength(2);
  });
});

const json = (value, init) => new Response(JSON.stringify(value), init);
