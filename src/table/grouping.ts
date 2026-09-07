// Folding a table by one of its columns.
//
// Grouping is the reader's, one column at a time, chosen from the columns
// that already offer a chip-set: a column worth filtering by is a column
// worth folding by, and no other column is. TanStack builds the groups; what
// is decided here is which column may be one, how the groups are ordered, and
// how the stripes read once a header row sits between two leaves.

import type { FacetGroup } from "./facet-groups";
import type { SortEntry } from "./sort-url";

export interface GroupOption {
  id: string;
  header: string;
}

/** The remembered column, if this table still has it and may fold by it. */
export function activeGroup(
  remembered: string | null,
  eligible: readonly string[],
): string | null {
  return remembered !== null && eligible.includes(remembered) ? remembered : null;
}

/**
 * The sort the table runs when grouped: the grouping column first, so the
 * groups follow that column's own order, then the reader's keys, which order
 * the leaves inside each group. The reader's own direction on the grouping
 * column is kept, so clicking its header turns the groups around.
 *
 * Derived, never written back: the URL and the page's memory still say only
 * what the reader clicked.
 */
export function groupingSorting(
  sorting: readonly SortEntry[],
  groupBy: string | null,
): SortEntry[] {
  if (groupBy === null) return sorting as SortEntry[];
  const own = sorting.find((entry) => entry.id === groupBy);
  return [
    { id: groupBy, desc: own?.desc ?? false },
    ...sorting.filter((entry) => entry.id !== groupBy),
  ];
}

/**
 * Stripe parity per display row. A header row carries no parity, so the
 * stripe rule cannot match it, and the count starts again beneath it: every
 * group then opens on the same stripe, and a header with its first row always
 * reads as the same pair.
 */
export function stripeParity(isGroup: readonly boolean[]): (boolean | null)[] {
  let leaf = 0;
  return isGroup.map((group) => {
    if (group) {
      leaf = 0;
      return null;
    }
    return leaf++ % 2 === 0;
  });
}

/** The columns the picker offers: exactly the columns with a chip-set. */
export function groupOptions(groups: readonly FacetGroup[]): GroupOption[] {
  return groups.map((group) => ({ id: group.columnId, header: group.label }));
}

/**
 * The leaves under a list of rows, in display order, whether or not their
 * group is open. An export is the view, and a folded group is still in it.
 */
export function leafRows<R extends { subRows: R[]; getIsGrouped: () => boolean }>(
  rows: readonly R[],
): R[] {
  const out: R[] = [];
  const walk = (row: R) => {
    if (row.getIsGrouped()) row.subRows.forEach(walk);
    else out.push(row);
  };
  rows.forEach(walk);
  return out;
}
