import { afterEach, expect, it, vi } from "vitest";
import { catalogDocs } from "../catalog-docs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../data");
  vi.resetModules();
});

it.each([
  { id: "default", generate: [{ plugin: "markdown", out: "docs" }], index: "/portolan/llms.txt", pages: "/portolan/docs/" },
  { id: "example", generate: [
    { plugin: "markdown", catalog: "portolan", out: "docs" },
    { plugin: "markdown", catalog: "example", out: "docs/example" },
  ], index: "/portolan/docs/example/llms.txt", pages: "/portolan/docs/example/" },
])("loads the index and catalog pages for $id", async ({ id, generate, index, pages }) => {
  vi.doMock("../data", () => ({ activeCatalogDocs: catalogDocs({ generate }, id, "/portolan/") }));
  const fetcher = vi.fn().mockResolvedValue(new Response("# Catalog documentation"));
  vi.stubGlobal("fetch", fetcher);
  const tools = await import("./tools");

  expect(await tools.loadIndex()).toBe("# Catalog documentation");
  expect(fetcher).toHaveBeenLastCalledWith(index);
  fetcher.mockResolvedValue(new Response("# Auth service"));
  expect(await tools.readPage("docs/auth/README.md")).toBe("# Auth service");
  expect(fetcher).toHaveBeenLastCalledWith(`${pages}auth/README.md`);
});
