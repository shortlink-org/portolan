import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docsDirectory, mountLinks, siteDocs } from "./site-docs.mjs";

describe("mountLinks", () => {
  it("points a relative link into the mount", () => {
    expect(mountLinks("- [Auth](auth/README.md): who someone is", "docs/")).toBe(
      "- [Auth](docs/auth/README.md): who someone is",
    );
  });

  it("keeps a link with a title", () => {
    expect(mountLinks('[full](llms-full.txt "all pages")', "docs/")).toBe(
      '[full](docs/llms-full.txt "all pages")',
    );
  });

  it("leaves absolute URLs, root paths and anchors alone", () => {
    const text = "[a](https://example.com/x.md) [b](/root.md) [c](#top) [d](mailto:x@y.z)";
    expect(mountLinks(text, "docs/")).toBe(text);
  });

  it("rewrites every link on a line, not only the first", () => {
    expect(mountLinks("[a](x.md) and [b](y/z.md)", "docs/")).toBe(
      "[a](docs/x.md) and [b](docs/y/z.md)",
    );
  });
});

describe("docsDirectory", () => {
  it("is the markdown step's output", () => {
    expect(docsDirectory({ generate: [{ plugin: "markdown", out: "docs" }] })).toBe("docs");
  });

  it("is null without a markdown step", () => {
    expect(docsDirectory({})).toBeNull();
    expect(docsDirectory({ generate: [{ plugin: "other", out: "x" }] })).toBeNull();
  });
});

describe("siteDocs", () => {
  it("copies the directory, mounts llms.txt at the root and skips the generator's file list", () => {
    const root = mkdtempSync(join(tmpdir(), "site-docs-"));
    const docs = join(root, "docs");
    const dist = join(root, "dist");
    mkdirSync(join(docs, "auth"), { recursive: true });
    mkdirSync(dist);
    writeFileSync(join(docs, "auth", "README.md"), "# Auth\n");
    writeFileSync(join(docs, ".portolan-manifest"), "{}");
    writeFileSync(join(docs, "llms.txt"), "# Estate\n\n- [Auth](auth/README.md)\n[full](llms-full.txt)\n");
    writeFileSync(join(docs, "llms-full.txt"), "<!-- auth/README.md -->\n# Auth\n");

    const written = siteDocs({ manifest: { generate: [{ plugin: "markdown", out: docs }] }, dist });

    expect(written).toEqual(["docs/", "llms.txt", "llms-full.txt"]);
    expect(readFileSync(join(dist, "docs", "auth", "README.md"), "utf8")).toBe("# Auth\n");
    expect(existsSync(join(dist, "docs", ".portolan-manifest"))).toBe(false);
    expect(readFileSync(join(dist, "llms.txt"), "utf8")).toBe(
      "# Estate\n\n- [Auth](docs/auth/README.md)\n[full](docs/llms-full.txt)\n",
    );
    expect(readFileSync(join(dist, "llms-full.txt"), "utf8")).toBe("<!-- auth/README.md -->\n# Auth\n");
  });

  it("does nothing when the docs are not generated yet", () => {
    const root = mkdtempSync(join(tmpdir(), "site-docs-"));
    const dist = join(root, "dist");
    mkdirSync(dist);

    expect(siteDocs({ manifest: { generate: [{ plugin: "markdown", out: join(root, "missing") }] }, dist })).toEqual([]);
    expect(existsSync(join(dist, "llms.txt"))).toBe(false);
  });
});
