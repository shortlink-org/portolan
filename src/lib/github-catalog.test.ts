import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogGlob,
  forgeRepoFromUrl,
  githubRepoFromUrl,
  listForgeBranches,
  listForgeRefs,
  listGitHubBranches,
  loadForgeCatalog,
  loadGitHubCatalog,
} from "./github-catalog";

const REPO = {
  provider: "github" as const,
  owner: "acme",
  repo: "portolan",
  webUrl: "https://github.com/acme/portolan",
};
const GITLAB_REPO = {
  provider: "gitlab" as const,
  origin: "https://gitlab.com",
  project: "acme/platform/portolan",
  webUrl: "https://gitlab.com/acme/platform/portolan",
};
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
  vi.unstubAllGlobals();
});

describe("githubRepoFromUrl", () => {
  it("accepts only a github.com repository page", () => {
    expect(githubRepoFromUrl("https://github.com/acme/portolan.git")).toEqual(REPO);
    expect(githubRepoFromUrl("https://gitlab.com/acme/portolan")).toBeNull();
    expect(githubRepoFromUrl("https://github.com/acme/portolan/issues")).toBeNull();
  });

  it("recognises GitLab subgroup projects and explicit self-hosted GitLab", () => {
    expect(forgeRepoFromUrl("https://gitlab.com/acme/platform/portolan.git")).toEqual(GITLAB_REPO);
    expect(
      forgeRepoFromUrl("https://code.acme.test/platform/portolan", "gitlab"),
    ).toEqual({
      provider: "gitlab",
      origin: "https://code.acme.test",
      project: "platform/portolan",
      webUrl: "https://code.acme.test/platform/portolan",
    });
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
  it("reads branch heads from the runtime API", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { name: "main", commit: { sha: SHA }, protected: true },
    ]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(listGitHubBranches(REPO)).resolves.toEqual([
      { name: "main", commit: SHA, protected: true, kind: "branch" },
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain("/repos/acme/portolan/branches?per_page=100&page=1");
  });

  // A tag is read at the commit it points to. GitHub's listing gives that
  // commit already, peeled from an annotated tag; the tag object's own sha
  // would be a tree nobody can read.
  it("reads tags at their commit, and lists them after the branches", async () => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("/tags?")
        ? [{ name: "v1.2.0", commit: { sha: "b".repeat(40) }, zipball_url: "" }]
        : [{ name: "main", commit: { sha: SHA }, protected: true }],
    ), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(listForgeRefs(REPO)).resolves.toEqual([
      { name: "main", commit: SHA, protected: true, kind: "branch" },
      { name: "v1.2.0", commit: "b".repeat(40), protected: false, kind: "tag" },
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toContainEqual(expect.stringContaining("/repos/acme/portolan/tags?per_page=100&page=1"));
  });

  it("reads GitLab tags through the repository API with the project encoded", async () => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("/repository/tags?")
        ? [{ name: "v2.0.0", commit: { id: "c".repeat(40) }, protected: true }]
        : [],
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(listForgeRefs(GITLAB_REPO, { token: "s" })).resolves.toEqual([
      { name: "v2.0.0", commit: "c".repeat(40), protected: true, kind: "tag" },
    ]);
    expect(fetch.mock.calls.map(([url]) => url)).toContainEqual(expect.stringContaining("/api/v4/projects/acme%2Fplatform%2Fportolan/repository/tags?per_page=100&page=1"));
  });

  it("explains the unauthenticated private-repository failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(listGitHubBranches(REPO)).rejects.toThrow("private repository needs an access token");
  });

  it("authenticates GitHub and GitLab branch requests without putting tokens in URLs", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await listForgeBranches(REPO, { token: "github-secret" });
    await listForgeBranches(GITLAB_REPO, { token: "gitlab-secret" });

    expect(fetch.mock.calls[0]?.[0]).not.toContain("github-secret");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer github-secret");
    expect(fetch.mock.calls[1]?.[0]).toContain("/api/v4/projects/acme%2Fplatform%2Fportolan/repository/branches");
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("private-token")).toBe("gitlab-secret");
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

  it("reuses a validated catalog from Cache Storage on the next load", async () => {
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

  it("reads private GitHub blobs through the API and never persists the catalog", async () => {
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
        tree: [{ path: "data/catalog.json", type: "blob", sha: "blob-sha", size: 100 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(source), { status: 200 }));
    vi.stubGlobal("caches", cache);
    vi.stubGlobal("fetch", fetch);

    await loadForgeCatalog(REPO, SHA, { token: "secret" });

    expect(fetch.mock.calls[0]?.[0]).toContain("/contents/portolan.json?ref=");
    expect(fetch.mock.calls[2]?.[0]).toContain("/git/blobs/blob-sha");
    for (const call of fetch.mock.calls) {
      expect(new Headers(call[1]?.headers).get("authorization")).toBe("Bearer secret");
      expect(String(call[0])).not.toContain("secret");
    }
    expect(cache.open).not.toHaveBeenCalled();
  });

  it("loads a private GitLab catalog through repository files", async () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: "blob-sha", path: "data/catalog.json", type: "blob" },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(source), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await loadForgeCatalog(GITLAB_REPO, SHA, { token: "secret" });

    expect(fetch.mock.calls[0]?.[0]).toContain("repository/files/portolan.json/raw?ref=");
    expect(fetch.mock.calls[1]?.[0]).toContain("repository/tree?recursive=true");
    expect(fetch.mock.calls[2]?.[0]).toContain("repository/files/data%2Fcatalog.json/raw?ref=");
    for (const call of fetch.mock.calls) {
      expect(new Headers(call[1]?.headers).get("private-token")).toBe("secret");
      expect(String(call[0])).not.toContain("secret");
    }
  });
});
