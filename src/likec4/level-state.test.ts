import { describe, expect, it } from "vitest";
import { diagramLevel, withDiagramLevel } from "./level-state";

describe("diagram level in a shared URL", () => {
  it("reads only a level the page can draw", () => {
    expect(diagramLevel(new URLSearchParams("level=2"), [1, 2], 1)).toBe(2);
    expect(diagramLevel(new URLSearchParams("level=3"), [1, 2], 1)).toBe(1);
    expect(diagramLevel(new URLSearchParams("level=nope"), [2, 3], 2)).toBe(2);
  });

  it("changes the level without losing the rest of the shared state", () => {
    expect(withDiagramLevel(new URLSearchParams("tab=data&focus=shop.cart"), 3).toString())
      .toBe("tab=data&focus=shop.cart&level=3");
    expect(withDiagramLevel(new URLSearchParams("tab=data&level=3"), 2).toString())
      .toBe("tab=data&level=2");
  });
});
