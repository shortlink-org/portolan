import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureLikeC4Bundle, likec4BundleFresh } from "./likec4-bundle.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A root with likec4/ sources stamped at `source` and the bundle stamped at `built`, or no bundle. */
function root({ source, built }) {
  const dir = mkdtempSync(join(tmpdir(), "portolan-likec4-"));
  roots.push(dir);
  mkdirSync(join(dir, "likec4"), { recursive: true });
  mkdirSync(join(dir, "src/likec4"), { recursive: true });
  const files = { "likec4/model.c4": source, "likec4/views.c4": source };
  if (built !== undefined) Object.assign(files, { "src/likec4/generated.jsx": built, "src/likec4/generated.d.ts": built });
  for (const [name, stamp] of Object.entries(files)) {
    writeFileSync(join(dir, name), "x");
    utimesSync(join(dir, name), stamp, stamp);
  }
  return dir;
}

describe("whether the LikeC4 react bundle follows from likec4/", () => {
  it("is yes when both generated files are at least as new as every source", () => {
    expect(likec4BundleFresh(root({ source: 1000, built: 2000 }))).toBe(true);
    expect(likec4BundleFresh(root({ source: 2000, built: 2000 }))).toBe(true);
  });

  it("is no when the bundle is missing, half there, or older than a source", () => {
    expect(likec4BundleFresh(root({ source: 1000 }))).toBe(false);

    const half = root({ source: 1000, built: 2000 });
    rmSync(join(half, "src/likec4/generated.d.ts"));
    expect(likec4BundleFresh(half)).toBe(false);

    const stale = root({ source: 1000, built: 2000 });
    utimesSync(join(stale, "likec4/views.c4"), 3000, 3000);
    expect(likec4BundleFresh(stale)).toBe(false);
  });

  it("does not run the generator for a fresh bundle", () => {
    const logged = [];
    expect(ensureLikeC4Bundle(root({ source: 1000, built: 2000 }), (line) => logged.push(line))).toBe(false);
    expect(logged).toEqual([]);
  });
});
