import type { LineItem } from "../vo/line-item.ts";

export const MAX_QUANTITY = 99;

/** One to 99 of a SKU on a line. Decrementing to zero is a removal, not a line. */
export function quantityIsSane(line: LineItem, already: number): string | null {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) return "quantity must be a whole number of at least 1";
  if (already + line.quantity > MAX_QUANTITY) return `at most ${MAX_QUANTITY} of one SKU`;
  return null;
}
