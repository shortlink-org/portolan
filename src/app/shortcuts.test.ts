// The "?" sheet is only useful if it is true. These are the two ways it could
// stop being true: a chord that goes nowhere, and a key bound twice.

import { describe, expect, it } from "vitest";
import { GO_TO, SHORTCUT_GROUPS } from "./shortcuts";
import { isRoutable } from "../routes";

describe("go-to chords", () => {
  it("every destination is a route this app actually serves", () => {
    for (const target of GO_TO) {
      expect(isRoutable(target.to), `g ${target.key} -> ${target.to}`).toBe(
        true,
      );
    }
  });

  it("binds each second key once", () => {
    const keys = GO_TO.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is what the sheet prints", () => {
    const listed =
      SHORTCUT_GROUPS.find((g) => g.group === "Go to")?.items ?? [];
    expect(listed.map((i) => i.keys)).toEqual(GO_TO.map((g) => ["g", g.key]));
  });
});

describe("the sheet", () => {
  it("names every key the handler implements", () => {
    const printed = SHORTCUT_GROUPS.flatMap((g) => g.items).flatMap(
      (i) => i.keys,
    );
    // Everything useShortcuts binds outside the go-to chord.
    for (const key of ["[", "]", "j", "k", "?", "⌘", "K", "Esc", "⏎"]) {
      expect(printed, `"${key}" is bound but not listed`).toContain(key);
    }
  });
});
