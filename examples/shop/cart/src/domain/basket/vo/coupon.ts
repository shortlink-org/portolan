import { BasketError } from "../errors.ts";
import type { Money } from "./money.ts";

/**
 * A coupon pricing accepted for a basket: the code as the customer typed it,
 * normalised, and the discount pricing agreed to. The discount is pricing's
 * answer, never computed here (cart.0003 holds for money off as for prices).
 */
export class AppliedCoupon {
  readonly code: string;
  readonly discount: Money;

  constructor(code: string, discount: Money) {
    const normalised = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,32}$/.test(normalised)) throw new BasketError("invalid", "a coupon code is 3 to 32 letters, digits or dashes");
    this.code = normalised;
    this.discount = discount;
  }
}
