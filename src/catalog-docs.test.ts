import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogDocs } from "./catalog-docs";
// @ts-expect-error The build's documentation mount is a plain JavaScript module.
import { siteDocs } from "../scripts/site-docs.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("catalog documentation URLs", () => {
  it.each(["default", "avia", "portolan"])("opens the files actually published for root catalog %s", (id) => {
    const root = mkdtempSync(join(tmpdir(), "catalog-docs-"));
    roots.push(root);
    const out = join(root, "generated", "markdown");
    const dist = join(root, "dist");
    mkdirSync(out, { recursive: true });
    mkdirSync(dist);
    writeFileSync(join(out, "llms.txt"), "# Catalog\n[Home](README.md)\n");
    writeFileSync(join(out, "llms-full.txt"), "# Full catalog\n");
    writeFileSync(join(out, "README.md"), "# Home\n");
    const manifest = { generate: [{ plugin: "markdown", ...(id === "default" ? {} : { catalog: id }), out }] };
    siteDocs({ manifest, dist });

    const urls = catalogDocs(manifest, id, "/portolan/")!;
    expect(urls.index).toBe("/portolan/llms.txt");
    const published = (url: string) => readFileSync(join(dist, url.slice("/portolan/".length)), "utf8");
    expect(published(urls.index)).toContain("[Home](docs/README.md)");
    expect(published(urls.full)).toBe("# Full catalog\n");
    expect(published(`${urls.pages}README.md`)).toBe("# Home\n");
  });

  it("uses a nested output directory even when it differs from the catalog id", () => {
    const manifest = { generate: [
      { plugin: "markdown", catalog: "avia", out: "./generated/docs/" },
      { plugin: "markdown", catalog: "example", out: "generated/docs/samples" },
    ] };
    expect(catalogDocs(manifest, "example", "/portolan")).toEqual({
      pages: "/portolan/docs/samples/",
      index: "/portolan/docs/samples/llms.txt",
      full: "/portolan/docs/samples/llms-full.txt",
    });
  });

  it("preserves the demo's example paths and supports a site served at /", () => {
    const manifest = { generate: [
      { plugin: "markdown", catalog: "portolan", out: "docs" },
      { plugin: "markdown", catalog: "example", out: "docs/example" },
    ] };
    expect(catalogDocs(manifest, "example", "/")?.index).toBe("/docs/example/llms.txt");
    expect(catalogDocs(manifest, "portolan", "/")?.index).toBe("/llms.txt");
  });

  it("does not invent URLs for missing or unmounted documentation", () => {
    expect(catalogDocs({}, "default", "/")).toBeNull();
    const manifest = { generate: [
      { plugin: "markdown", catalog: "avia", out: "docs" },
      { plugin: "markdown", catalog: "example", out: "docs-other" },
    ] };
    expect(catalogDocs(manifest, "unknown", "/")).toBeNull();
    expect(catalogDocs(manifest, "example", "/")).toBeNull();
  });
});
