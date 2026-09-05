import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogGlob,
  clearGitHubCatalogCache,
  githubRepoFromUrl,
  listGitHubBranches,
  loadGitHubCatalog,
} from "./github-catalog";

const REPO = { owner: "acme", repo: "portolan" };
const SHA = "a".repeat(40);

function memoryCacheStorage() {
  const entries = new Map<string, Response>();
  const keyOf = (request: RequestInfo) => typeof request === "string" ? request : request.url;
  const store = {
    match: vi.fn(async (request: RequestInfo) => entries.get(keyOf(request))?.clone()),
    put: vi.fn(async (request: RequestInfo, response: Response) => {
      entries.set(keyOf(request), response.clone());
    }),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (request: RequestInfo) => entries.delete(keyOf(request))),
  };
  return { open: vi.fn(async () => store), store, entries };
}

afterEach(() => {
  clearGitHubCatalogCache();
  vi.unstubAllGlobals();
});

describe("githubRepoFromUrl", () => {
  it("accepts only a github.com repository page", () => {
    expect(githubRepoFromUrl("https://github.com/acme/portolan.git")).toEqual(REPO);
    expect(githubRepoFromUrl("https://gitlab.com/acme/portolan")).toBeNull();
    expect(githubRepoFromUrl("https://github.com/acme/portolan/issues")).toBeNull();
  });
});

describe("catalogGlob", () => {
  it("keeps one star inside a path segment and lets two cross segments", () => {
    expect(catalogGlob("examples/*/portolan/*.json").test("examples/auth/portolan/api.json")).toBe(true);
    expect(catalogGlob("examples/*/portolan/*.json").test("examples/shop/auth/portolan/api.json")).toBe(false);
    expect(catalogGlob("examples/**/portolan/*.json").test("examples/shop/auth/portolan/api.json")).toBe(true);
  });
});

describe("listGitHubBranches", () => {
  it("reads branch heads from the runtime API and caches the result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { name: "main", commit: { sha: SHA }, protected: true },
    ]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(listGitHubBranches(REPO)).resolves.toEqual([
      { name: "main", commit: SHA, protected: true },
    ]);
    await listGitHubBranches(REPO);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain("/repos/acme/portolan/branches?per_page=100&page=1");
  });

  it("explains the unauthenticated private-repository failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(listGitHubBranches(REPO)).rejects.toThrow("Private repositories need an authenticated integration");
  });
});

describe("loadGitHubCatalog", () => {
  it("discovers manifest sources at an immutable SHA and validates the merge", async () => {
    const source = {
      generatedAt: "2026-09-05T00:00:00Z",
      commit: SHA,
      contexts: [],
      defs: {},
      flows: [],
      adrs: [],
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sources: ["data/*.json"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        truncated: false,
        tree: [
          { path: "README.md", type: "blob", size: 10 },
          { path: "data/catalog.json", type: "blob", size: 100 },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(source), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const catalog = await loadGitHubCatalog(REPO, SHA);

    expect(catalog.contexts).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]?.[0]).toContain(`/${SHA}/data/catalog.json`);
  });

  it("reuses a validated catalog from Cache Storage after the page memory is cleared", async () => {
    const source = {
      generatedAt: "2026-09-05T00:00:00Z",
      commit: SHA,
      contexts: [],
      defs: {},
      flows: [],
      adrs: [],
    };
    const cache = memoryCacheStorage();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sources: ["data/*.json"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        truncated: false,
        tree: [{ path: "data/catalog.json", type: "blob", size: 100 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(source), { status: 200 }));
    vi.stubGlobal("caches", cache);
    vi.stubGlobal("fetch", fetch);

    await loadGitHubCatalog(REPO, SHA);
    clearGitHubCatalogCache();
    const restored = await loadGitHubCatalog(REPO, SHA);

    expect(restored.commit).toBe(SHA);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(cache.store.put).toHaveBeenCalledTimes(2);
  });

  it("keeps only the eight most recently used commit catalogs", async () => {
    const cache = memoryCacheStorage();
    const fetch = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/portolan.json")) {
        return new Response(JSON.stringify({ sources: ["data/*.json"] }), { status: 200 });
      }
      if (url.includes("/git/trees/")) {
        return new Response(JSON.stringify({
          truncated: false,
          tree: [{ path: "data/catalog.json", type: "blob", size: 100 }],
        }), { status: 200 });
      }
      const sha = url.split("/").at(-3) ?? "";
      return new Response(JSON.stringify({
        generatedAt: "2026-09-05T00:00:00Z",
        commit: sha,
        contexts: [],
        defs: {},
        flows: [],
        adrs: [],
      }), { status: 200 });
    });
    vi.stubGlobal("caches", cache);
    vi.stubGlobal("fetch", fetch);

    for (let i = 1; i <= 9; i++) {
      await loadGitHubCatalog(REPO, String(i).repeat(40));
    }

    expect(cache.entries.size).toBe(8);
    expect([...cache.entries.keys()].some((key) => key.endsWith(`/${"1".repeat(40)}`))).toBe(false);
  });

  it("refuses a truncated recursive tree instead of comparing partial state", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sources: ["data/*.json"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ truncated: true, tree: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(loadGitHubCatalog(REPO, SHA)).rejects.toThrow("truncated");
  });
});
