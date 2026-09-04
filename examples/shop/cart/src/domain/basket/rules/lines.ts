export const MAX_LINES = 50;

/** At most 50 distinct SKUs. A basket is not a wishlist. */
export function linesAreFew(distinct: number, isNew: boolean): string | null {
  if (isNew && distinct >= MAX_LINES) return `at most ${MAX_LINES} distinct SKUs`;
  return null;
}
