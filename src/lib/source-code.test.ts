import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSourceCode,
  sourceLanguage,
  sourceGrammar,
  sourceWindow,
  SourceLoadError,
} from "./source-code";
import type { RemoteSourceLocation, SourceLocation } from "./source-link";

const github: RemoteSourceLocation = {
  kind: "remote",
  provider: "github",
  origin: "https://github.com",
  repositoryUrl: "https://github.com/acme/shop",
  ref: "a".repeat(40),
  path: "internal/cart/cart.go",
  line: 3,
  href: "https://github.com/acme/shop/blob/a/internal/cart/cart.go#L3",
};

const gitlab: RemoteSourceLocation = {
  ...github,
  provider: "gitlab",
  origin: "https://gitlab.example.test",
  repositoryUrl: "https://gitlab.example.test/platform/acme/shop",
  href: "https://gitlab.example.test/platform/acme/shop/-/blob/a/internal/cart/cart.go#L3",
};

afterEach(() => vi.unstubAllGlobals());

describe("loadSourceCode", () => {
  it("loads GitHub contents at the catalog commit with a bearer token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("package cart\n", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadSourceCode(github, "secret")).resolves.toMatchObject({
      content: "package cart\n",
      path: github.path,
      ref: github.ref,
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      `/repos/acme/shop/contents/internal/cart/cart.go?ref=${github.ref}`,
    );
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(init.cache).toBe("no-store");
  });

  it("loads nested GitLab projects with PRIVATE-TOKEN", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("package cart\n", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await loadSourceCode(gitlab, "private");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/api/v4/projects/platform%2Facme%2Fshop/repository/files/internal%2Fcart%2Fcart.go/raw",
    );
    expect(init.headers).toEqual({ "PRIVATE-TOKEN": "private" });
  });

  it("classifies an anonymous 404 as possible private-repository access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    );
    const error = await loadSourceCode(github).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SourceLoadError);
    expect(error).toMatchObject({ status: 404, authRequired: true });
  });

  it("asks the forge every time; remembering the answer is the query layer's job", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockImplementation(async () => new Response("ok\n", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadSourceCode(github)).rejects.toBeInstanceOf(
      SourceLoadError,
    );
    await loadSourceCode(github, "token");
    await loadSourceCode(github, "token");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("uses the localhost-only endpoint for a local source", async () => {
    const local: SourceLocation = {
      kind: "local",
      path: "internal/cart/cart.go",
      line: 1,
      href: null,
    };
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ path: local.path, content: "package cart\n" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(loadSourceCode(local)).resolves.toMatchObject({
      content: "package cart\n",
      ref: "working tree",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/__portolan/source",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("rejects binary and oversized remote files", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 0, 2]), { status: 200 }),
        ),
    );
    await expect(loadSourceCode(github)).rejects.toThrow("binary file");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("", {
            status: 200,
            headers: { "content-length": "1048577" },
          }),
        ),
    );
    await expect(loadSourceCode(github)).rejects.toThrow("1 MB preview limit");
  });
});

describe("sourceWindow", () => {
  it("centres a bounded window on the catalog line", () => {
    const rows = sourceWindow(
      Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"),
      10,
      2,
    );
    expect(rows.map((row) => row.number)).toEqual([8, 9, 10, 11, 12]);
    expect(rows.find((row) => row.focused)?.text).toBe("line 10");
  });

  it("labels common source languages", () => {
    expect(sourceLanguage("internal/cart/cart.go")).toBe("Go");
    expect(sourceLanguage("api/provider.wsdl")).toBe("WSDL");
    expect(sourceLanguage("ui/checkout.tsx")).toBe("TSX");
    expect(sourceGrammar("ui/checkout.tsx")).toBe("typescript");
    expect(sourceGrammar("api/provider.wsdl")).toBe("xml");
    expect(sourceGrammar("schema/catalog.proto")).toBeNull();
  });
});
