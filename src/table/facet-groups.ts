// The chip-sets, read off the table's own model.
//
// TanStack counts the distinct values of a column once, memoised against the
// rows; this turns that count into what the toolbar draws. Nothing here walks
// the data a second time, and nothing here decides which rows are in - the
// counts are the whole table's, so the set never changes shape under the
// reader's hand.

import type { FacetValue } from "./Facets";
import { comparatorFor } from "./compare";
import type { ColumnSpec, ColumnType } from "./types";
import { canFacet, cellText } from "./types";

export interface FacetGroup {
  columnId: string;
  label: string;
  values: FacetValue[];
  selected: string[];
}

/**
 * The chips of one column, from TanStack's unique-value map. The empty cell is
 * not a value to filter by; a set of one is not a filter at all. Values read
 * in the column's own order, so a status set is not alphabetical and a kind
 * set is not either.
 */
export function facetValuesFrom(
  counts: ReadonlyMap<unknown, number>,
  type: ColumnType,
): FacetValue[] {
  const merged = new Map<string, number>();
  for (const [key, count] of counts) {
    // The map is keyed by what the accessor returned; two keys that read the
    // same are one chip.
    const value = cellText(key as string | number | undefined);
    if (value === "") continue;
    merged.set(value, (merged.get(value) ?? 0) + count);
  }
  if (merged.size < 2) return [];
  const compare = comparatorFor(type);
  return [...merged.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([value, count]) => ({ value, count }));
}

/** One toolbar group, or nothing when the column does not offer one. */
export function facetGroupFrom<T>(
  spec: ColumnSpec<T>,
  counts: ReadonlyMap<unknown, number>,
  selected: string[],
): FacetGroup | null {
  if (!spec.facet || !canFacet(spec.type)) return null;
  const values = facetValuesFrom(counts, spec.type);
  if (values.length === 0) return null;
  return { columnId: spec.id, label: spec.header, values, selected };
}
