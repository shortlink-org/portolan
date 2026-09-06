import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STORE_KINDS } from "../catalog";
import {
  STORE_KIND_GLYPH,
  TECH_GLYPH,
  TECH_WITHOUT_GLYPH,
  techGlyph,
} from "./tech";

/**
 * The names extract-project can write, read off its own source: every
 * `{"Name", <seen>}` marker in the technologies table. Reading the Go file
 * rather than copying the list is the point - a marker added there and
 * forgotten here is exactly what this test exists to catch.
 */
function extractedTechnologies(): string[] {
  const source = readFileSync(
    new URL("../../plugins/extract-project/extract.go", import.meta.url),
    "utf8",
  );
  const body = source.slice(source.indexOf("func technologies("));
  return [...body.matchAll(/^\s*\{"([^"]+)", /gm)].map((m) => m[1] ?? "");
}

describe("store kind glyphs", () => {
  it("decides for every store kind, glyph or none", () => {
    for (const kind of STORE_KINDS) {
      expect(kind in STORE_KIND_GLYPH).toBe(true);
    }
  });

  it("draws a real path for the kinds that have one", () => {
    expect(STORE_KIND_GLYPH.postgres?.path).toMatch(/^M/);
    expect(STORE_KIND_GLYPH.postgres?.title).toBe("PostgreSQL");
    expect(STORE_KIND_GLYPH.other).toBeNull();
  });
});

describe("technology glyphs", () => {
  const markers = extractedTechnologies();

  it("reads the marker list off extract-project", () => {
    expect(markers).toContain("Go");
    expect(markers).toContain("Kafka");
    expect(markers.length).toBeGreaterThan(10);
  });

  it("gives every extract-project marker a glyph or names it as having none", () => {
    for (const name of markers) {
      const decided = name in TECH_GLYPH || TECH_WITHOUT_GLYPH.includes(name);
      expect(decided, `${name} has neither a glyph nor a place in TECH_WITHOUT_GLYPH`).toBe(true);
    }
  });

  it("keeps the two lists disjoint and free of names the extractor never writes", () => {
    for (const name of Object.keys(TECH_GLYPH)) {
      expect(TECH_WITHOUT_GLYPH).not.toContain(name);
      expect(markers, `${name} is not a name extract-project writes`).toContain(name);
    }
    for (const name of TECH_WITHOUT_GLYPH) {
      expect(markers).toContain(name);
    }
  });

  it("spells one brand once across the two vocabularies", () => {
    expect(TECH_GLYPH.PostgreSQL).toBe(STORE_KIND_GLYPH.postgres);
    expect(TECH_GLYPH.Redis).toBe(STORE_KIND_GLYPH.redis);
  });

  it("answers null for a word with no mark", () => {
    expect(techGlyph("River")).toBeNull();
    expect(techGlyph("Go")?.title).toBe("Go");
  });
});
