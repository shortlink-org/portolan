// A sorted view is a place, so it has an address.
//
// ?sort=name.desc, or ?sort=severity.desc,age.asc for a shift-clicked second
// key. Only index pages carry it: a table inside a README has no URL of its
// own to write to, and two READMEs open in two panes would fight over one.

/** The shape the table keeps its sort in. Mirrors TanStack's SortingState. */
export interface SortEntry {
  id: string;
  desc: boolean;
}

export const SORT_PARAM = "sort";

/**
 * Reads "name.desc,age.asc". Anything malformed, or naming a column this
 * table does not have, is dropped rather than thrown: a URL is user input,
 * and a stale link should land on an unsorted table, not an error.
 */
export function parseSort(
  raw: string | null | undefined,
  columnIds: readonly string[],
): SortEntry[] {
  if (!raw) return [];
  const known = new Set(columnIds);
  const seen = new Set<string>();
  const out: SortEntry[] = [];
  for (const term of raw.split(",")) {
    const at = term.lastIndexOf(".");
    if (at <= 0) continue;
    const id = term.slice(0, at);
    const dir = term.slice(at + 1);
    if (dir !== "asc" && dir !== "desc") continue;
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, desc: dir === "desc" });
  }
  return out;
}

/** The inverse. An empty sort has no term, so the param drops out entirely. */
export function formatSort(sort: readonly SortEntry[]): string {
  return sort.map((s) => `${s.id}.${s.desc ? "desc" : "asc"}`).join(",");
}

/** True when two sorts say the same thing, so an effect can decline to write. */
export function sameSort(
  a: readonly SortEntry[],
  b: readonly SortEntry[],
): boolean {
  return formatSort(a) === formatSort(b);
}
