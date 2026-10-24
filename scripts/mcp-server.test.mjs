import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "cli/portolan.mjs");
const cleanups = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe("portolan mcp", () => {
  it("exposes the generated catalog through read-only stdio tools", async () => {
    const fixture = mkdtempSync(resolve(tmpdir(), "portolan-mcp-"));
    cleanups.push(() => rmSync(fixture, { recursive: true, force: true }));
    mkdirSync(resolve(fixture, "docs/shop/oms"), { recursive: true });
    writeFileSync(resolve(fixture, "portolan.json"), JSON.stringify({
      defaultCatalog: "shop",
      catalogs: [{ id: "shop", title: "Shop", sources: [], contexts: ["shop"], projects: [] }],
      generate: [{ plugin: "markdown", catalog: "shop", out: "docs", options: { title: "Shop" } }],
    }));
    writeFileSync(resolve(fixture, "docs/agent.json"), JSON.stringify({
      version: 1,
      title: "Shop",
      pages: { shop: "shop/README.md", "shop.oms": "shop/oms/README.md", checkout: "flows/checkout.md" },
      catalog: {
        generatedAt: "2026-10-24T00:00:00Z",
        commit: "abc123",
        contexts: [{ id: "shop", slug: "shop", name: "Shop", summary: "Commerce", services: [{ id: "shop.oms", slug: "oms", name: "Order management", readme: "Handles orders", provides: [], consumes: [], aggregates: [], dependsOn: [] }] }],
        defs: {},
        flows: [{ id: "checkout", slug: "checkout", name: "Checkout", summary: "Places an order", owner: "shop", participants: [], steps: [] }],
        adrs: [],
      },
    }));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--cwd", fixture],
      stderr: "pipe",
    });
    const client = new Client(
      { name: "portolan-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    cleanups.push(async () => {
      await client.close();
    });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "search_catalog",
      "get_resource",
      "get_related",
      "explain_flow",
      "show_resource",
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const search = await client.callTool({ name: "search_catalog", arguments: { query: "order", kinds: ["service"] } });
    expect(search.structuredContent).toMatchObject({
      profile: "shop",
      commit: "abc123",
      results: [{ id: "shop.oms", kind: "service", name: "Order management" }],
    });

    const resource = await client.callTool({ name: "get_resource", arguments: { id: "shop.oms" } });
    expect(resource.structuredContent).toMatchObject({
      profile: "shop",
      resource: { id: "shop.oms", kind: "service", page: "shop/oms/README.md" },
    });
  }, 20_000);
});
