import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareSite } from "../cli/portolan.mjs";
import { isProfileSources, SITE_SOURCES_MODULE, siteSources, siteSourcesPlugin } from "./site-sources.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fragment = (id) => ({ contexts: [{ id, slug: id, name: id, services: [] }], defs: {}, flows: [], adrs: [] });

function workspace(manifest, files) {
  const root = mkdtempSync(join(tmpdir(), "portolan-site-sources-"));
  roots.push(root);
  writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(content));
  }
  return root;
}

/** What a loaded module's `export default <expression>;` evaluates to. */
function exported({ code }) {
  return new Function(`return ${code.slice("export default ".length)}`)();
}

describe("the site's sources", () => {
  const manifest = {
    sources: ["portolan/*.json", "examples/*/portolan/*.json", "shared/*.json"],
    catalogs: [
      { id: "portolan", title: "Portolan", contexts: ["portolan", "owners"], projects: [], sources: ["portolan/*.json", "shared/*.json"] },
      // A profile pattern the manifest's sources do not cover stays out of
      // the site, as it did when the site's globs were written out.
      { id: "example", title: "Example", contexts: ["shop", "bff", "owners"], projects: [], sources: ["examples/*/portolan/*.json", "shared/*.json", "vendor/*.json"] },
    ],
  };
  const files = {
    "portolan/self.json": fragment("portolan"),
    "examples/shop/portolan/domain.json": fragment("shop"),
    "examples/bff/portolan/domain.json": fragment("bff"),
    "shared/owners.json": fragment("owners"),
    "vendor/extra.json": fragment("extra"),
  };

  it("are the manifest's sources, kept for the profiles whose patterns match them", () => {
    const root = workspace(manifest, files);
    expect(Object.fromEntries(siteSources(root))).toEqual({
      portolan: ["portolan/self.json", "shared/owners.json"],
      example: ["examples/bff/portolan/domain.json", "examples/shop/portolan/domain.json", "shared/owners.json"],
    });
  });

  it("are one catalog, default, when the manifest has no profiles", () => {
    const root = workspace({ sources: ["portolan/*.json"] }, { "portolan/a.json": fragment("a"), "portolan/b.json": fragment("b") });
    expect(Object.fromEntries(siteSources(root))).toEqual({ default: ["portolan/a.json", "portolan/b.json"] });
  });

  it("are served as an index of loaders and one module per profile, keyed by path", () => {
    const root = workspace(manifest, files);
    const plugin = siteSourcesPlugin();
    plugin.configResolved({ root });
    const watched = [];
    const context = { addWatchFile: (file) => watched.push(file), error: (message) => { throw new Error(message); } };

    const index = plugin.load.call(context, plugin.resolveId(SITE_SOURCES_MODULE));
    expect(index).toContain(`"portolan": () => import("virtual:portolan-sources/portolan")`);
    expect(index).toContain(`"example": () => import("virtual:portolan-sources/example")`);

    const id = plugin.resolveId("virtual:portolan-sources/example");
    expect(isProfileSources(id)).toBe(true);
    expect(isProfileSources("/src/data.ts")).toBe(false);
    const sources = exported(plugin.load.call(context, id));
    expect(Object.keys(sources)).toEqual(["examples/bff/portolan/domain.json", "examples/shop/portolan/domain.json", "shared/owners.json"]);
    expect(sources["examples/shop/portolan/domain.json"]).toEqual(fragment("shop"));
    // Each file it carries is watched, so an edit updates the module.
    expect(watched).toEqual(Object.keys(sources).map((path) => join(root, path)));
  });

  it("keep a key spelled __proto__ a key", () => {
    const root = workspace({ sources: ["portolan/*.json"] }, {});
    mkdirSync(join(root, "portolan"));
    writeFileSync(join(root, "portolan/odd.json"), '{"defs":{"__proto__":{"type":"string"}}}');
    const plugin = siteSourcesPlugin();
    plugin.configResolved({ root });
    const sources = exported(plugin.load.call({ addWatchFile() {} }, plugin.resolveId("virtual:portolan-sources/default")));
    expect(Object.keys(sources["portolan/odd.json"].defs)).toEqual(["__proto__"]);
  });

  it("are the flattened files a staged site imports, per profile", { timeout: 30_000 }, async () => {
    const root = workspace(
      { ...manifest, sources: ["portolan/*.json"] },
      files,
    );
    const stage = await prepareSite(root);
    const staged = Object.fromEntries(siteSources(stage));
    expect(staged.portolan).toHaveLength(2);
    expect(staged.example).toHaveLength(4);
    for (const path of [...staged.portolan, ...staged.example]) expect(path).toMatch(/^portolan\/source-\d{4}\.json$/);
  });
});
