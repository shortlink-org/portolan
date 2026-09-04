import { Money } from "../vo/money.ts";

/** A line went in, or grew. */
export class BasketItemAdded {
  readonly name = "cart.BasketItemAdded";
  constructor(
    readonly basketId: string,
    readonly sku: string,
    readonly quantity: number,
    readonly unitPrice: Money,
  ) {}
}
