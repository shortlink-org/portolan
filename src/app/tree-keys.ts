// The arrow keys in the catalog tree, as a function of the rows on screen.
//
// j and k already walk the tree the way they walk every list, but a tree is
// more than a list: a branch opens and closes, and a reader on a leaf wants
// the branch it hangs from. This is the tree's own grammar - the one every
// file browser and outliner taught - and it is decided here, on a description
// of the rows, so the Sidebar has only to describe its rows and carry out
// the answer.
//
//   ↓ ↑     the next or previous row, whatever depth it is at
//   →       open a closed branch; on an open one, step into its first child
//   ←       close an open branch; on anything else, go up to the parent
//   Home    the first row
//   End     the last row

export interface TreeRow {
  depth: number;
  /** true or false for a branch; null for a leaf, which has nothing to open. */
  open: boolean | null;
}

export type TreeMove =
  | { type: "focus"; index: number }
  | { type: "toggle"; index: number };

export const TREE_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowRight",
  "ArrowLeft",
  "Home",
  "End",
]);

/** The nearest row above `at` that is shallower than it: the parent. */
export function parentOf(rows: readonly TreeRow[], at: number): number {
  const depth = rows[at]?.depth ?? 0;
  for (let i = at - 1; i >= 0; i--) {
    if (rows[i]!.depth < depth) return i;
  }
  return -1;
}

/**
 * What `key` does when the reader is on row `at` (or on none, when `at` is
 * -1) of `rows`, or null when the key does nothing there - so the caller can
 * leave the event alone and let the page scroll.
 */
export function treeKey(
  rows: readonly TreeRow[],
  at: number,
  key: string,
): TreeMove | null {
  const last = rows.length - 1;
  if (last < 0) return null;

  switch (key) {
    case "ArrowDown":
      return { type: "focus", index: at < 0 ? 0 : Math.min(last, at + 1) };
    case "ArrowUp":
      return { type: "focus", index: at < 0 ? last : Math.max(0, at - 1) };
    case "Home":
      return { type: "focus", index: 0 };
    case "End":
      return { type: "focus", index: last };
  }

  const row = rows[at];
  if (!row) return null;

  if (key === "ArrowRight") {
    if (row.open === false) return { type: "toggle", index: at };
    const next = rows[at + 1];
    if (row.open === true && next && next.depth > row.depth) {
      return { type: "focus", index: at + 1 };
    }
    return null;
  }

  if (key === "ArrowLeft") {
    if (row.open === true) return { type: "toggle", index: at };
    const parent = parentOf(rows, at);
    return parent >= 0 ? { type: "focus", index: parent } : null;
  }

  return null;
}
