import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STORE_KINDS } from "../catalog";
import {
  STORE_KIND_GLYPH,
  TECH_MARKS,
  TECH_WITHOUT_GLYPH,
  techGlyph,
  techKey,
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

describe("techKey", () => {
  it("folds case and punctuation", () => {
    expect(techKey("Node.js")).toBe("nodejs");
    expect(techKey("NodeJS")).toBe("nodejs");
    expect(techKey("Apache Kafka")).toBe("apachekafka");
    expect(techKey("Spring Boot")).toBe("springboot");
  });

  it("keeps what makes C++ and C# different languages from C", () => {
    expect(techKey("C++")).toBe("c++");
    expect(techKey("C#")).toBe("c#");
    expect(techKey("C")).toBe("c");
  });
});

describe("techGlyph", () => {
  it("answers the same mark for every spelling of one brand", () => {
    const postgres = techGlyph("PostgreSQL");
    expect(postgres?.title).toBe("PostgreSQL");
    for (const spelling of ["postgres", "Postgres", "postgresql", "pg", "psql"]) {
      expect(techGlyph(spelling), spelling).toEqual(postgres);
    }
    expect(techGlyph("nodejs")?.title).toBe("Node.js");
    expect(techGlyph("Kafka")?.title).toBe("Apache Kafka");
    expect(techGlyph("k8s")?.title).toBe("Kubernetes");
  });

  it("answers null for a word with no mark", () => {
    expect(techGlyph("River")).toBeNull();
    expect(techGlyph("")).toBeNull();
    expect(techGlyph("something nobody ships")).toBeNull();
  });

  it("draws a real path for every mark", () => {
    for (const mark of TECH_MARKS) {
      expect(mark.path, mark.title).toMatch(/^[Mm]/);
      expect(mark.names[0]).toBe(mark.title);
    }
  });

  it("gives no name to two marks", () => {
    const seen = new Map<string, string>();
    for (const mark of TECH_MARKS) {
      // An alias that folds to the title's own key is redundant, not a clash.
      for (const key of new Set(mark.names.map(techKey))) {
        const name = mark.names.find((n) => techKey(n) === key);
        expect(
          seen.get(key),
          `"${name}" names both ${seen.get(key)} and ${mark.title}`,
        ).toBeUndefined();
        seen.set(key, mark.title);
      }
    }
  });
});

describe("store kind glyphs", () => {
  it("decides for every store kind, glyph or none", () => {
    for (const kind of STORE_KINDS) {
      expect(kind in STORE_KIND_GLYPH).toBe(true);
    }
  });

  it("draws the kinds that have a mark and leaves the rest a word", () => {
    expect(STORE_KIND_GLYPH.postgres?.title).toBe("PostgreSQL");
    expect(STORE_KIND_GLYPH.redis?.title).toBe("Redis");
    expect(STORE_KIND_GLYPH.s3).toBeNull();
    expect(STORE_KIND_GLYPH.other).toBeNull();
  });
});

describe("extract-project markers", () => {
  const markers = extractedTechnologies();

  it("are read off the Go source", () => {
    expect(markers).toContain("Go");
    expect(markers).toContain("Kafka");
    expect(markers.length).toBeGreaterThan(10);
  });

  it("each have a glyph or are named as having none", () => {
    for (const name of markers) {
      const decided = techGlyph(name) !== null || TECH_WITHOUT_GLYPH.includes(name);
      expect(decided, `${name} has neither a glyph nor a place in TECH_WITHOUT_GLYPH`).toBe(true);
    }
  });

  it("are not listed as having none when they have one", () => {
    for (const name of TECH_WITHOUT_GLYPH) {
      expect(markers, `${name} is not a name extract-project writes`).toContain(name);
      expect(techGlyph(name), `${name} has a glyph after all`).toBeNull();
    }
  });
});
