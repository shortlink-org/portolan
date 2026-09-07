import { describe, expect, it } from "vitest";
import { parentOf, treeKey } from "./tree-keys";
import type { TreeRow } from "./tree-keys";

// shop (open)
//   oms (open)
//     Order (closed)
//     Cart (leaf)
//   billing (closed)
// auth (closed)
const rows: TreeRow[] = [
  { depth: 0, open: true },
  { depth: 1, open: true },
  { depth: 2, open: false },
  { depth: 2, open: null },
  { depth: 1, open: false },
  { depth: 0, open: false },
];

describe("parentOf", () => {
  it("is the nearest shallower row above", () => {
    expect(parentOf(rows, 3)).toBe(1);
    expect(parentOf(rows, 4)).toBe(0);
    expect(parentOf(rows, 1)).toBe(0);
  });

  it("is -1 at the top level", () => {
    expect(parentOf(rows, 0)).toBe(-1);
    expect(parentOf(rows, 5)).toBe(-1);
  });
});

describe("treeKey", () => {
  it("walks down and up, and stops at the ends", () => {
    expect(treeKey(rows, 0, "ArrowDown")).toEqual({ type: "focus", index: 1 });
    expect(treeKey(rows, 5, "ArrowDown")).toEqual({ type: "focus", index: 5 });
    expect(treeKey(rows, 3, "ArrowUp")).toEqual({ type: "focus", index: 2 });
    expect(treeKey(rows, 0, "ArrowUp")).toEqual({ type: "focus", index: 0 });
  });

  it("enters the tree at either end when nothing is focused", () => {
    expect(treeKey(rows, -1, "ArrowDown")).toEqual({ type: "focus", index: 0 });
    expect(treeKey(rows, -1, "ArrowUp")).toEqual({ type: "focus", index: 5 });
    expect(treeKey(rows, -1, "ArrowRight")).toBeNull();
    expect(treeKey(rows, -1, "ArrowLeft")).toBeNull();
  });

  it("jumps to the first and last row", () => {
    expect(treeKey(rows, 3, "Home")).toEqual({ type: "focus", index: 0 });
    expect(treeKey(rows, 3, "End")).toEqual({ type: "focus", index: 5 });
  });

  it("opens a closed branch, then steps into it", () => {
    expect(treeKey(rows, 2, "ArrowRight")).toEqual({ type: "toggle", index: 2 });
    expect(treeKey(rows, 1, "ArrowRight")).toEqual({ type: "focus", index: 2 });
  });

  it("does nothing on a leaf, or on an open branch with no children", () => {
    expect(treeKey(rows, 3, "ArrowRight")).toBeNull();
    const childless: TreeRow[] = [{ depth: 0, open: true }, { depth: 0, open: null }];
    expect(treeKey(childless, 0, "ArrowRight")).toBeNull();
  });

  it("closes an open branch, and goes up from anything else", () => {
    expect(treeKey(rows, 1, "ArrowLeft")).toEqual({ type: "toggle", index: 1 });
    expect(treeKey(rows, 3, "ArrowLeft")).toEqual({ type: "focus", index: 1 });
    expect(treeKey(rows, 2, "ArrowLeft")).toEqual({ type: "focus", index: 1 });
    expect(treeKey(rows, 4, "ArrowLeft")).toEqual({ type: "focus", index: 0 });
  });

  it("does nothing going up from the top level, or on an empty tree", () => {
    expect(treeKey(rows, 5, "ArrowLeft")).toBeNull();
    expect(treeKey([], -1, "ArrowDown")).toBeNull();
  });

  it("ignores keys it does not own", () => {
    expect(treeKey(rows, 1, "Enter")).toBeNull();
    expect(treeKey(rows, 1, "j")).toBeNull();
  });
});
