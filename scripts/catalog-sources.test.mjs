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

  it("still reports missing sources for a configured project", async () => {
    const { path, missing } = manifest({ sources: [], projects: [] });
    writeFileSync(path, `${JSON.stringify({ sources: [missing], projects: [{ id: "billing" }], extract: [] }, null, 2)}\n`);
    await expect(loadCatalog(path)).rejects.toThrow(/no catalog matched/);
  });
});
