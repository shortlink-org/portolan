import type { Money } from "../vo/money.ts";

/** Pricing accepted a coupon and the basket took the discount it agreed to. */
export class CouponApplied {
  readonly name = "cart.CouponApplied";
  readonly basketId: string;
  readonly code: string;
  readonly discount: Money;
  readonly occurredAt: Date;

  constructor(basketId: string, code: string, discount: Money, occurredAt: Date) {
    this.basketId = basketId;
    this.code = code;
    this.discount = discount;
    this.occurredAt = occurredAt;
  }
}
