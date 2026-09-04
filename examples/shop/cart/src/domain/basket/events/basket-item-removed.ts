/** A line went out. */
export class BasketItemRemoved {
  readonly name = "cart.BasketItemRemoved";
  readonly basketId: string;
  readonly sku: string;
  readonly occurredAt: Date;

  constructor(basketId: string, sku: string, occurredAt: Date) {
    this.basketId = basketId;
    this.sku = sku;
    this.occurredAt = occurredAt;
  }
}
