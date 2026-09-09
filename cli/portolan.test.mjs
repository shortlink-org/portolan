import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareSite, VERSION } from "./portolan.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("site staging", () => {
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
