import { Money } from "../vo/money.ts";

/** A line went in, or grew; `quantity` is the line's after the add. */
export class BasketItemAdded {
  readonly name = "cart.BasketItemAdded";
  readonly basketId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly occurredAt: Date;

  constructor(basketId: string, sku: string, quantity: number, unitPrice: Money, occurredAt: Date) {
    this.basketId = basketId;
    this.sku = sku;
    this.quantity = quantity;
    this.unitPrice = unitPrice;
    this.occurredAt = occurredAt;
  }
}
