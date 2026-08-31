import { describe, expect, it } from "vitest";
import {
  KIND_CHIP,
  KIND_LABEL,
  KIND_PLURAL,
  KIND_PREFIXES,
  LEAF_KINDS,
  canonicalPrefix,
  isLeafKind,
  kindForPrefix,
  parseQuery,
} from "./kinds";
import type { Kind } from "./kinds";

const ALL_KINDS = Object.keys(KIND_PREFIXES) as Kind[];

describe("the taxonomy", () => {
  it("labels, pluralises and prefixes every kind", () => {
    for (const kind of ALL_KINDS) {
      expect(KIND_LABEL[kind], kind).toBeTruthy();
      expect(KIND_PLURAL[kind], kind).toBeTruthy();
      expect(KIND_PREFIXES[kind].length, kind).toBeGreaterThan(0);
    }
    for (const kind of LEAF_KINDS) expect(KIND_CHIP[kind], kind).toBeTruthy();
  });

  it("never gives one prefix to two kinds", () => {
    const seen = new Map<string, Kind>();
    for (const kind of ALL_KINDS) {
      for (const prefix of KIND_PREFIXES[kind]) {
        expect(seen.get(prefix), `"${prefix}:" is claimed twice`).toBeUndefined();
        seen.set(prefix, kind);
      }
    }
  });

  it("resolves the prefixes the palette advertises", () => {
    expect(kindForPrefix("e")).toBe("event");
    expect(kindForPrefix("vo")).toBe("vo");
    expect(kindForPrefix("agg")).toBe("aggregate");
    expect(kindForPrefix("cmd")).toBe("command");
    expect(kindForPrefix("q")).toBe("query");
    expect(kindForPrefix("ENT")).toBe("entity");
    expect(kindForPrefix("nope")).toBeNull();
  });

  it("names only leaf kinds as leaves", () => {
    expect(LEAF_KINDS.every(isLeafKind)).toBe(true);
    expect(isLeafKind("service")).toBe(false);
    expect(canonicalPrefix("vo")).toBe("vo");
  });
});

describe("parseQuery", () => {
  it("splits a known prefix off the term", () => {
    expect(parseQuery("e: item")).toEqual({
      kind: "event",
      term: "item",
      prefix: "e",
    });
    expect(parseQuery("vo:money")).toEqual({
      kind: "vo",
      term: "money",
      prefix: "vo",
    });
    expect(parseQuery("  agg:  cart  ")).toEqual({
      kind: "aggregate",
      term: "cart",
      prefix: "agg",
    });
  });

  it("treats a prefix with nothing after it as browse-this-kind", () => {
    expect(parseQuery("q:")).toEqual({ kind: "query", term: "", prefix: "q" });
  });

  // An unknown prefix must not silently filter everything away.
  it("searches the whole string when the prefix means nothing", () => {
    expect(parseQuery("note: this")).toEqual({
      kind: null,
      term: "note: this",
      prefix: null,
    });
    expect(parseQuery("shop.oms")).toEqual({
      kind: null,
      term: "shop.oms",
      prefix: null,
    });
  });
});
