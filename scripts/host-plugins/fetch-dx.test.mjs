import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FRAGMENT_NAME, LOCK_NAME, fragment, repositoryOf, run, serviceIdentity } from "./fetch-dx.mjs";

const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-dx-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

it("maps DX identifiers and repository aliases", () => {
  expect(serviceIdentity("shop.cart", "fallback")).toEqual({ context: "shop", slug: "cart", id: "shop.cart" });
  expect(serviceIdentity("payments-api", "payments").id).toBe("payments.payments-api");
  expect(repositoryOf({ github_repo: [{ name: "acme/shop" }] })).toBe("github.com/acme/shop");
});

it("renders a deterministic fragment with dependencies", () => {
  const entities = [
    { identifier: "shop.pricing", name: "Pricing" },
    { identifier: "shop.cart", name: "Cart", description: "Baskets", properties: { language: ["TypeScript", "Go"] }, aliases: { github_repo: [{ name: "acme/shop" }] } },
  ];
  const value = JSON.parse(fragment(entities, new Map([["shop.cart", ["shop.pricing"]]]), { defaultContext: "dx", technologyProperty: "language" }));
  expect(value.contexts[0].services[0]).toMatchObject({ id: "shop.cart", repo: "github.com/acme/shop", dependsOn: ["shop.pricing"], technologies: ["Go", "TypeScript"] });
});

describe("fetch-dx", () => {
  it("follows entity and relation pagination without exposing the token", async () => {
    const seen = [];
    const fetch = async (url, init) => {
      seen.push([String(url), init.headers.Authorization]);
      const parsed = new URL(url);
      if (parsed.pathname === "/catalog.entities.list") {
        const second = parsed.searchParams.get("cursor") === "next";
        return new Response(JSON.stringify({ ok: true, entities: second ? [{ identifier: "shop.pricing", name: "Pricing" }] : [{ identifier: "shop.cart", name: "Cart" }], response_metadata: { next_cursor: second ? null : "next" } }));
      }
      return new Response(JSON.stringify({ ok: true, entity_relations: parsed.searchParams.get("entity_identifier") === "shop.cart" ? [{ identifier: "shop.pricing", name: "Pricing" }] : [], response_metadata: { next_cursor: null } }));
    };
    const result = await run({ options: { cache: cache(), defaultContext: "dx", relations: ["service-depends-on-service"] } }, { env: { DX_API_TOKEN: "secret" }, fetch });
    expect(JSON.parse(result.files.find((file) => file.name === FRAGMENT_NAME).contents).contexts[0].services[0].dependsOn).toEqual(["shop.pricing"]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(seen).toHaveLength(4);
  });

  it("replays a verified offline snapshot", async () => {
    const dir = cache();
    writeCached(dir);
    const result = await run({ options: { cache: dir, defaultContext: "dx" } }, { env: { PORTOLAN_OFFLINE: "1" } });
    expect(result.files.map((file) => file.name)).toEqual([FRAGMENT_NAME, LOCK_NAME]);
    expect(result.warnings[0].message).toContain("offline");
  });

  it("fails on missing or rejected credentials instead of hiding them with a snapshot", async () => {
    const dir = cache();
    writeCached(dir);
    await expect(run({ options: { cache: dir, defaultContext: "dx" } }, { env: {} })).rejects.toThrow(/DX_API_TOKEN is not set/);

    const fetch = vi.fn(async () => new Response('{"ok":false,"error":"invalid_auth"}', { status: 401 }));
    await expect(run(
      { options: { cache: dir, defaultContext: "dx" } },
      { env: { DX_API_TOKEN: "bad" }, fetch },
    )).rejects.toThrow(/invalid_auth/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses the snapshot only after transient retries are exhausted", async () => {
    const dir = cache();
    writeCached(dir);
    const fetch = vi.fn(async () => new Response('{"ok":false,"error":"busy"}', { status: 503 }));
    const wait = vi.fn();

    const result = await run(
      { options: { cache: dir, defaultContext: "dx" } },
      { env: { DX_API_TOKEN: "secret" }, fetch, retries: 1, wait },
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(result.warnings[0].message).toContain("busy");
  });
});

function writeCached(dir) {
  const contents = `${JSON.stringify({ contexts: [], defs: {}, flows: [], adrs: [] }, null, 2)}\n`;
  writeFileSync(join(dir, FRAGMENT_NAME), contents);
  writeFileSync(join(dir, LOCK_NAME), `${JSON.stringify({ server: "https://api.getdx.com", entities: [], sha256: createHash("sha256").update(contents).digest("hex") }, null, 2)}\n`);
}
