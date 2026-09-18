import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadCatalog } from "./catalog-sources.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function manifest(value) {
  const root = mkdtempSync(join(tmpdir(), "portolan-empty-catalog-"));
  roots.push(root);
  const path = join(root, "portolan.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return { path, missing: join(root, "portolan/*.json") };
}

describe("catalog sources", () => {
  it("loads an intentional empty workspace as an empty catalog", async () => {
    const { path, missing } = manifest({ sources: [], projects: [], extract: [], verify: [] });
    writeFileSync(path, `${JSON.stringify({ sources: [missing], projects: [], extract: [], verify: [] }, null, 2)}\n`);
    const loaded = await loadCatalog(path);
    expect(loaded.sources).toEqual([]);
    expect(loaded.catalog).toMatchObject({ contexts: [], defs: {}, flows: [], adrs: [] });
  });

  // A verifier writes the flow back and the merge lays it over the
  // declaration step for step, so it is handed the flow as declared - not
  // the method the enrichment found the opening answers (portolan.0031).
  it("hands a verifier the estate enriched and the flows as declared", async () => {
    const { path } = manifest({});
    const source = join(path, "..", "domain.json");
    const flow = {
      id: "flow.auth-logout", slug: "auth-logout", name: "Logout", summary: "Ends a session.", source: "logout.go", owner: "auth",
      trigger: { kind: "http", label: "logout", confidence: "high" },
      participants: [
        { id: "client", kind: "actor", context: null },
        { id: "auth.auth", kind: "service", context: "auth" },
      ],
      steps: [{ type: "step", id: "s1", from: "client", to: "auth.auth", kind: "rpc", label: "logout", status: "declared" }],
    };
    writeFileSync(source, `${JSON.stringify({
      generatedAt: "2026-01-01T00:00:00Z", commit: "abc1234", defs: {}, adrs: [],
      contexts: [{ id: "auth", slug: "auth", name: "Auth", services: [{
        id: "auth.auth", slug: "auth", name: "Auth", consumes: [], aggregates: [],
        provides: [{ id: "auth.v1", methods: [{ name: "logout", http: { method: "POST", path: "/v1/logout" } }] }],
      }] }],
      flows: [flow],
    })}\n`);
    writeFileSync(path, `${JSON.stringify({ sources: [source], projects: [], extract: [], verify: [] })}\n`);

    const loaded = await loadCatalog(path);
    expect(loaded.catalog.flows[0].steps[0].ref).toBe("auth.v1/logout");
    expect(loaded.verifierCatalog.flows).toEqual([flow]);
    expect(loaded.verifierCatalog.contexts).toBe(loaded.catalog.contexts);
  });

  it("still reports missing sources for a configured project", async () => {
    const { path, missing } = manifest({ sources: [], projects: [] });
    writeFileSync(path, `${JSON.stringify({
      sources: [missing],
      projects: [{
        id: "billing",
        name: "Billing",
        root: "services/billing",
        context: "shop",
        service: "billing",
      }],
      extract: [],
    }, null, 2)}\n`);
    await expect(loadCatalog(path)).rejects.toThrow(/no catalog matched/);
  });
});
