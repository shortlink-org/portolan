/** Nobody touched the basket for a day, and the sweep said so (cart.0006). */
export class BasketAbandoned {
  readonly name = "cart.BasketAbandoned";
  readonly basketId: string;
  readonly customerId: string | undefined;
  readonly idleSince: Date;
  readonly occurredAt: Date;

  constructor(basketId: string, customerId: string | undefined, idleSince: Date, occurredAt: Date) {
    this.basketId = basketId;
    this.customerId = customerId;
    this.idleSince = idleSince;
    this.occurredAt = occurredAt;
  }
}
