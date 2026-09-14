import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { eventBridgeState, saveEventBridgeSettings } from "./eventbridge-settings.mjs";
import { localApiPlugin, writeManifest } from "./local-api.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "portolan-eventbridge-settings-"));
  roots.push(root);
  const manifest = {
    sources: ["data/*.json"],
    plugins: [],
    projects: [],
    catalogs: [
      { id: "app", title: "App", sources: ["data/*.json"], contexts: ["app"], projects: [] },
      { id: "other", title: "Other", sources: ["other/*.json"], contexts: ["other"], projects: [] },
    ],
    defaultCatalog: "app",
    extract: [],
    verify: [],
    generate: [],
  };
  writeFileSync(join(root, "portolan.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest };
}

function save(root, request = {}) {
  return saveEventBridgeSettings(root, {
    revision: eventBridgeState(root).revision,
    step: null,
    catalogs: ["app"],
    regions: ["eu-west-1"],
    buses: ["orders"],
    sources: { "com.acme.orders": "shop.orders" },
    targets: { "lambda:invoice-handler": "shop.billing" },
    ruleTags: { context: "portolan.context", service: "portolan.service" },
    generate: false,
    ...request,
  }, writeManifest);
}

describe("persisted EventBridge settings", () => {
  it("registers the host plugin, extractor, cache and selected catalog source", () => {
    const { root } = workspace();
    const before = eventBridgeState(root);
    const state = save(root, { regions: ["eu-west-1", "eu-west-1", " us-east-1 "] });
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(manifest.plugins).toContainEqual({ name: "eventbridge", host: "fetch-eventbridge" });
    expect(manifest.extract).toContainEqual({
      plugin: "eventbridge",
      in: ".",
      out: "portolan-eventbridge",
      options: {
        regions: ["eu-west-1", "us-east-1"],
        buses: ["orders"],
        sources: { "com.acme.orders": "shop.orders" },
        targets: { "lambda:invoice-handler": "shop.billing" },
        ruleTags: { context: "portolan.context", service: "portolan.service" },
        cache: "portolan-eventbridge",
      },
    });
    expect(manifest.sources).toContain("portolan-eventbridge/eventbridge.json");
    expect(manifest.catalogs[0].sources).toContain("portolan-eventbridge/eventbridge.json");
    expect(manifest.catalogs[1].sources).not.toContain("portolan-eventbridge/eventbridge.json");
    expect(state.entries[0]).toMatchObject({ step: 0, output: "portolan-eventbridge", cache: "portolan-eventbridge", managed: true, catalogs: ["app"] });
    expect(state.revision).not.toBe(before.revision);
  });

  it("updates one extractor, supports multiple scopes and removes empty optional settings", () => {
    const { root } = workspace();
    save(root);
    save(root, { step: 0, catalogs: ["other"], regions: ["ap-southeast-1"], buses: [], sources: {}, targets: {}, ruleTags: undefined });
    save(root, { step: null, catalogs: ["app"], regions: ["us-east-2"], buses: [], sources: {}, targets: {}, ruleTags: undefined });
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(manifest.extract).toHaveLength(2);
    expect(manifest.extract[0]).toMatchObject({ out: "portolan-eventbridge", options: { regions: ["ap-southeast-1"], cache: "portolan-eventbridge" } });
    expect(manifest.extract[0].options).not.toHaveProperty("buses");
    expect(manifest.extract[0].options).not.toHaveProperty("sources");
    expect(manifest.extract[0].options).not.toHaveProperty("targets");
    expect(manifest.extract[0].options).not.toHaveProperty("ruleTags");
    expect(manifest.extract[1]).toMatchObject({ out: "portolan-eventbridge-2", options: { cache: "portolan-eventbridge-2" } });
    expect(manifest.catalogs[0].sources).toContain("portolan-eventbridge-2/eventbridge.json");
    expect(manifest.catalogs[1].sources).toContain("portolan-eventbridge/eventbridge.json");
  });

  it("rejects stale, invalid or unsafe changes without touching the manifest", () => {
    const { root } = workspace();
    const before = readFileSync(join(root, "portolan.json"), "utf8");
    expect(() => save(root, { revision: "stale" })).toThrow(/changed since/);
    expect(() => save(root, { regions: [] })).toThrow(/at least one region/);
    expect(() => save(root, { sources: { "com.acme": "missing-context" } })).toThrow(/context.service/);
    expect(() => save(root, { ruleTags: { context: "context-only", service: "" } })).toThrow(/both context and service/);
    expect(() => save(root, { catalogs: ["missing"] })).toThrow(/known catalog/);
    expect(readFileSync(join(root, "portolan.json"), "utf8")).toBe(before);
  });

  it("preserves manual output and rejects changing manual source scope", () => {
    const { root, manifest } = workspace();
    manifest.plugins = [{ name: "eventbridge", host: "fetch-eventbridge" }];
    manifest.extract = [{ plugin: "eventbridge", in: ".", out: "manual/aws", options: { regions: ["eu-west-1"], cache: "manual/aws", buses: ["orders"] } }];
    manifest.sources.push("manual/aws/*.json");
    manifest.catalogs[0].sources.push("manual/aws/*.json");
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    save(root, { step: 0, catalogs: ["app"], regions: ["us-west-2"], buses: [], sources: {}, targets: {}, ruleTags: undefined });
    const written = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(written.extract[0]).toMatchObject({ plugin: "eventbridge", out: "manual/aws", options: { cache: "manual/aws", regions: ["us-west-2"] } });
    expect(() => save(root, { step: 0, catalogs: ["other"] })).toThrow(/manually configured/);
  });

  it("serves revisioned settings and gates writes through the local endpoint", async () => {
    const { root } = workspace();
    let middleware;
    localApiPlugin(root).configureServer({ config: { base: "/" }, middlewares: { use: (handler) => { middleware = handler; } } });
    const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/__portolan/eventbridge`;
    try {
      const state = await (await fetch(url)).json();
      expect(state.entries).toEqual([]);
      const body = JSON.stringify({ revision: state.revision, step: null, catalogs: ["app"], regions: ["eu-west-1"], buses: [], sources: {}, targets: {}, generate: false });
      expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(405);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Portolan-Local": "1" }, body });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ run: null, entries: [{ regions: ["eu-west-1"], catalogs: ["app"] }] });
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
