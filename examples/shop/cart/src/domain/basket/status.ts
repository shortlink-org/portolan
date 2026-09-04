// The basket's lifecycle, as one table. Every way a basket can move is a row
// here and nowhere else: a method that changes the status goes through
// `moveTo`, which reads the table, so a transition nobody wrote down cannot
// happen quietly. Three ways out of `open`, and none back - a checked-out,
// abandoned or merged basket is a record, not a thing that changes.

export type BasketStatus = "open" | "checked-out" | "abandoned" | "merged";

/** Where a basket can go from where it is. */
export const TRANSITIONS: Readonly<Record<BasketStatus, readonly BasketStatus[]>> = {
  open: ["checked-out", "abandoned", "merged"],
  "checked-out": [],
  abandoned: [],
  merged: [],
};

/** The states in which lines still go in and out. */
export const EDITABLE: readonly BasketStatus[] = ["open"];

export function canMove(from: BasketStatus, to: BasketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
