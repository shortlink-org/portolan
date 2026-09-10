import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareSite, VERSION } from "./portolan.mjs";
import { provenancePlugin, PROVENANCE_MODULE } from "../scripts/provenance.mjs";
import { mergeCatalogs } from "../src/merge.ts";
import { validateCatalog } from "../src/catalog.ts";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("site staging", () => {
  it("keeps original Git provenance for flattened sources in every catalog profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-staged-provenance-"));
    roots.push(root);
    const fragment = (id) => JSON.stringify({ contexts: [{ id, slug: id, name: id, services: [] }], defs: {}, flows: [], adrs: [] });
    mkdirSync(join(root, "data"));
    mkdirSync(join(root, "examples/shop/portolan"), { recursive: true });
    writeFileSync(join(root, "data/self.json"), fragment("portolan"));
    writeFileSync(join(root, "examples/shop/portolan/domain.json"), fragment("shop"));
    // The example is profile-only: provenance must cover every staged source.
    writeFileSync(join(root, "portolan.json"), JSON.stringify({
      sources: ["data/*.json"],
      catalogs: [
        { id: "portolan", title: "Portolan", contexts: ["portolan"], projects: [], sources: ["data/*.json"] },
        { id: "example", title: "Example", contexts: ["shop"], projects: [], sources: ["examples/*/portolan/*.json"] },
      ],
    }));
    const git = (...args) => execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com", GIT_AUTHOR_DATE: "2026-03-03T03:00:00Z", GIT_COMMITTER_DATE: "2026-03-03T03:00:00Z" },
    }).trim();
    git("init", "-q");
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "catalogs");
    const commit = git("rev-parse", "--short=7", "HEAD");

    const stage = await prepareSite(root);
    const plugin = provenancePlugin(root);
    plugin.configResolved({ root: stage });
    const module = plugin.load(plugin.resolveId(PROVENANCE_MODULE));
    const stamps = JSON.parse(module.slice("export default ".length).trim().replace(/;$/, ""));
    const manifest = JSON.parse(readFileSync(join(stage, "portolan.json"), "utf8"));
    for (const [i, profile] of manifest.catalogs.entries()) {
      const sources = profile.sources.map((path) => ({
        path, catalog: JSON.parse(readFileSync(join(stage, path), "utf8")), stamp: stamps[path],
      }));
      expect(sources).toHaveLength(1);
      expect(sources[0].catalog.generatedAt).toBeUndefined();
      // The stamp is the workspace file's, and it says which file: the path a
      // project's root is a prefix of, which the flattened name is not.
      expect(sources[0].stamp).toEqual({ commit, generatedAt: "2026-03-03T03:00:00Z", source: i === 0 ? "data/self.json" : "examples/shop/portolan/domain.json" });
      const catalog = validateCatalog(mergeCatalogs(sources).catalog);
      expect(catalog.contexts.map((context) => context.id)).toEqual([i === 0 ? "portolan" : "shop"]);
    }
  });

  it("stages a deterministic source for an intentional empty workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-empty-site-"));
    roots.push(root);
    writeFileSync(join(root, "portolan.json"), `${JSON.stringify({ sources: ["portolan/*.json"], projects: [], extract: [], verify: [], generate: [] }, null, 2)}\n`);

    const stage = await prepareSite(root);
    const stagedPackage = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
    const stagedManifest = JSON.parse(readFileSync(join(stage, "portolan.json"), "utf8"));
    expect(stagedPackage.version).toBe(VERSION);
    expect(stagedManifest.sources).toEqual(["portolan/source-0000.json"]);
    expect(existsSync(join(stage, "portolan/source-0000.json"))).toBe(true);
  });

  it("stages binary files referenced by a service README as public assets", async () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-readme-assets-"));
    roots.push(root);
    const project = "vendor/repos/acme/shop";
    mkdirSync(join(root, project, "portolan"), { recursive: true });
    mkdirSync(join(root, project, "docs"), { recursive: true });
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
    writeFileSync(join(root, project, "docs/example.png"), image);
    writeFileSync(join(root, project, "README.md"), "# Shop\n");
    writeFileSync(join(root, project, "portolan/project.json"), `${JSON.stringify({
      generatedAt: "2026-09-09T00:00:00Z",
      commit: "abc1234",
      contexts: [{ id: "shop", slug: "shop", name: "Shop", services: [{ id: "shop.api", slug: "api", name: "API", repo: "github.com/acme/shop", path: project, readme: "![example](./docs/example.png)", provides: [], consumes: [], aggregates: [] }] }],
      defs: {}, flows: [], adrs: [],
    }, null, 2)}\n`);
    writeFileSync(join(root, "portolan.json"), `${JSON.stringify({ sources: [`${project}/portolan/*.json`] }, null, 2)}\n`);

    const stage = await prepareSite(root);
    expect(readFileSync(join(stage, "public/portolan-assets", project, "docs/example.png"))).toEqual(image);
  });
});
