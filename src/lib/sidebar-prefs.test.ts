import { describe, expect, it } from "vitest";
import { parseFlags, serializeFlags } from "./sidebar-prefs";

describe("parseFlags", () => {
  it("round-trips what it wrote", () => {
    const flags = { flows: false, contexts: true };
    expect(parseFlags(serializeFlags(flags))).toEqual(flags);
  });

  it("treats anything that is not a flag map as nothing remembered", () => {
    expect(parseFlags(null)).toEqual({});
    expect(parseFlags("")).toEqual({});
    expect(parseFlags("nope")).toEqual({});
    expect(parseFlags("[]")).toEqual({});
    expect(parseFlags("null")).toEqual({});
    expect(parseFlags('"folded"')).toEqual({});
  });

  it("keeps only the entries that are booleans", () => {
    // A section is folded or it is not. "0", "false" and null are three ways
    // of half-saying so, and a half-read flag folds a band the reader never
    // folded.
    const raw = JSON.stringify({
      flows: false,
      contexts: "false",
      decisions: 0,
      pinned: true,
      nested: { open: true },
    });
    expect(parseFlags(raw)).toEqual({ flows: false, pinned: true });
  });
});
