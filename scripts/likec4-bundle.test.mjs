import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { STAMP, ensureLikeC4Bundle, likec4BundleFresh, likec4Stamp, writeLikeC4Stamp } from "./likec4-bundle.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/**
 * A root with likec4/ sources stamped at `source` and the bundle stamped at
 * `built`, or no bundle. A built bundle carries the installed likec4's stamp
 * unless `stamp` says otherwise (null: none).
 */
function root({ source, built, stamp = likec4Stamp() }) {
  const dir = mkdtempSync(join(tmpdir(), "portolan-likec4-"));
  roots.push(dir);
  mkdirSync(join(dir, "likec4"), { recursive: true });
  mkdirSync(join(dir, "src/likec4"), { recursive: true });
  const files = { "likec4/model.c4": source, "likec4/views.c4": source };
  if (built !== undefined) Object.assign(files, { "src/likec4/generated.jsx": built, "src/likec4/generated.d.ts": built });
  for (const [name, time] of Object.entries(files)) {
    writeFileSync(join(dir, name), "x");
    utimesSync(join(dir, name), time, time);
  }
  if (built !== undefined && stamp) writeLikeC4Stamp(dir, stamp);
  return dir;
}

/** ensureLikeC4Bundle with the spawn replaced by a recorder that touches the outputs. */
function ensure(dir) {
  const runs = [];
  const ran = ensureLikeC4Bundle(dir, () => {}, (cwd, bin) => {
    runs.push(bin);
    for (const output of ["src/likec4/generated.jsx", "src/likec4/generated.d.ts"]) writeFileSync(join(cwd, output), "y");
  });
  return { ran, runs };
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

  it("is no when another likec4, other arguments, or no stamp at all wrote the bundle", () => {
    expect(likec4BundleFresh(root({ source: 1000, built: 2000, stamp: likec4Stamp("0.0.1") }))).toBe(false);
    expect(likec4BundleFresh(root({ source: 1000, built: 2000, stamp: { ...likec4Stamp(), args: ["gen", "react"] } }))).toBe(false);
    expect(likec4BundleFresh(root({ source: 1000, built: 2000, stamp: null }))).toBe(false);

    const garbled = root({ source: 1000, built: 2000 });
    writeFileSync(join(garbled, STAMP), "{");
    expect(likec4BundleFresh(garbled)).toBe(false);
  });

  it("does not run the generator for a fresh bundle with the same likec4 and unchanged sources", () => {
    const logged = [];
    expect(ensureLikeC4Bundle(root({ source: 1000, built: 2000 }), (line) => logged.push(line))).toBe(false);
    expect(logged).toEqual([]);
    expect(ensure(root({ source: 1000, built: 2000 }))).toEqual({ ran: false, runs: [] });
  });

  it("runs the generator after a likec4 upgrade over unchanged sources, and stamps the result", () => {
    const upgraded = root({ source: 1000, built: 2000, stamp: likec4Stamp("0.0.1") });
    const first = ensure(upgraded);
    expect(first.ran).toBe(true);
    expect(first.runs).toHaveLength(1);
    expect(first.runs[0]).toMatch(/likec4[\\/]bin[\\/]likec4\.mjs$/);
    expect(JSON.parse(readFileSync(join(upgraded, STAMP), "utf8"))).toEqual(likec4Stamp());

    expect(ensure(upgraded)).toEqual({ ran: false, runs: [] });
  });
});
