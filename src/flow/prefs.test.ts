import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEQUENCE_MAX_STEPS,
  defaultVariant,
  readPrefs,
  writePrefs,
} from "./prefs";

/** The node test environment has no localStorage; this is the whole of one. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

describe("defaultVariant", () => {
  it("keeps a short flow as a sequence, where order is position", () => {
    expect(defaultVariant(1)).toBe("sequence");
    expect(defaultVariant(SEQUENCE_MAX_STEPS)).toBe("sequence");
  });

  it("folds a long flow onto the diagram, which fits on a screen", () => {
    expect(defaultVariant(SEQUENCE_MAX_STEPS + 1)).toBe("diagram");
    expect(defaultVariant(45)).toBe("diagram");
  });
});

describe("readPrefs", () => {
  beforeEach(() => {
    stubStorage();
  });

  it("falls back to the caller's default when nothing was remembered", () => {
    expect(readPrefs("checkout", "diagram")).toEqual({
      variant: "diagram",
      expanded: false,
    });
  });

  it("remembers per flow rather than globally", () => {
    writePrefs("checkout", { variant: "sequence", expanded: true });
    expect(readPrefs("checkout", "diagram").variant).toBe("sequence");
    expect(readPrefs("refund-requested", "diagram").variant).toBe("diagram");
  });

  it("ignores a stored value that is not a variant", () => {
    localStorage.setItem(
      "portolan.flow.checkout",
      JSON.stringify({ variant: "isometric", expanded: true }),
    );
    const prefs = readPrefs("checkout", "sequence");
    expect(prefs.variant).toBe("sequence");
    // The half of the record that parsed is still honoured: one bad field is
    // not a reason to forget the other one.
    expect(prefs.expanded).toBe(true);
  });

  it("survives storage that is broken rather than merely empty", () => {
    localStorage.setItem("portolan.flow.checkout", "{not json");
    expect(readPrefs("checkout", "sequence")).toEqual({
      variant: "sequence",
      expanded: false,
    });

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    });
    expect(readPrefs("checkout", "diagram").variant).toBe("diagram");
    expect(() => writePrefs("checkout", { variant: "sequence", expanded: false })).not.toThrow();
  });
});
