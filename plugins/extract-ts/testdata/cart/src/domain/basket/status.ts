export type BasketStatus = "open" | "checked-out" | "abandoned";

/** Where a basket can go from where it is: two ways out of open, none back. */
export const TRANSITIONS: Readonly<Record<BasketStatus, readonly BasketStatus[]>> = {
  open: ["checked-out", "abandoned"],
  "checked-out": [],
  abandoned: [],
};

export function canMove(from: BasketStatus, to: BasketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
