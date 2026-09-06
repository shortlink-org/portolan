/** @typedef {"open" | "checked-out" | "abandoned"} BasketStatus */

/**
 * Where a basket can go from where it is: two ways out of open, none back.
 * @type {Readonly<Record<BasketStatus, readonly BasketStatus[]>>}
 */
export const TRANSITIONS = {
  open: ["checked-out", "abandoned"],
  "checked-out": [],
  abandoned: [],
};

/**
 * @param {BasketStatus} from
 * @param {BasketStatus} to
 * @returns {boolean}
 */
export function canMove(from, to) {
  return TRANSITIONS[from].includes(to);
}
