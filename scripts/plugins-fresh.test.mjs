import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { newestMtime, pluginsFresh } from "./plugins-fresh.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function at(path, seconds) {
  utimesSync(path, seconds, seconds);
}

/** A workspace with a built wasm and Java classes, all stamped at `built`, over sources stamped at `source`. */
function workspace({ source, built }) {
  const root = mkdtempSync(join(tmpdir(), "portolan-fresh-"));
  roots.push(root);
  for (const dir of ["plugins/verify-otel", "plugins/extract-java/src/org", "plugins/extract-java/build/org", "catalog", "plugin"]) mkdirSync(join(root, dir), { recursive: true });
  const files = {
    "go.mod": source, "plugins/verify-otel/verify.go": source, "catalog/model.go": source, "plugin/protocol.go": source,
    "plugins/extract-java/src/org/Main.java": source,
    "plugins/portolan-go.wasm": built, "plugins/extract-java/build/org/Main.class": built,
  };
  for (const [name, stamp] of Object.entries(files)) {
    writeFileSync(join(root, name), "x");
    at(join(root, name), stamp);
  }
  return root;
}

describe("whether the built plugins are newer than their sources", () => {
  it("is yes when every artefact is at least as new as every source", () => {
    expect(pluginsFresh(workspace({ source: 1000, built: 2000 }))).toBe(true);
    expect(pluginsFresh(workspace({ source: 2000, built: 2000 }))).toBe(true);
  });

  it("is no when a Go source, a Java source, or go.mod is newer, or an artefact is missing", () => {
    const go = workspace({ source: 1000, built: 2000 });
    at(join(go, "catalog/model.go"), 3000);
    expect(pluginsFresh(go)).toBe(false);

    const java = workspace({ source: 1000, built: 2000 });
    at(join(java, "plugins/extract-java/src/org/Main.java"), 3000);
    expect(pluginsFresh(java)).toBe(false);

    const mod = workspace({ source: 1000, built: 2000 });
    at(join(mod, "go.mod"), 3000);
    expect(pluginsFresh(mod)).toBe(false);

    const missing = workspace({ source: 1000, built: 2000 });
    rmSync(join(missing, "plugins/portolan-go.wasm"));
    expect(pluginsFresh(missing)).toBe(false);
  });

  it("leaves a plugin's own build output and test data out of the sources", () => {
    const root = workspace({ source: 1000, built: 2000 });
    mkdirSync(join(root, "plugins/extract-rust/target"), { recursive: true });
    writeFileSync(join(root, "plugins/extract-rust/target/out.go"), "x");
    at(join(root, "plugins/extract-rust/target/out.go"), 5000);
    expect(pluginsFresh(root)).toBe(true);
    expect(newestMtime(join(root, "plugins"), (path) => path.endsWith(".go"))).toBe(1000 * 1000);
  });
});
