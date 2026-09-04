/** A basket exists, for a visitor or for a customer. */
export class BasketCreated {
  readonly name = "cart.BasketCreated";
  readonly basketId: string;
  readonly customerId: string | undefined;
  readonly occurredAt: Date;

  constructor(basketId: string, customerId: string | undefined, occurredAt: Date) {
    this.basketId = basketId;
    this.customerId = customerId;
    this.occurredAt = occurredAt;
  }
}
