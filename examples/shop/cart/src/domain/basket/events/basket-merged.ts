/**
 * The visitor's basket has given its lines to the customer's and is done
 * (cart.0005). `basketId` is the one that emptied; `intoBasketId` the one
 * that now holds everything.
 */
export class BasketMerged {
  readonly name = "cart.BasketMerged";
  readonly basketId: string;
  readonly intoBasketId: string;
  readonly customerId: string;
  readonly occurredAt: Date;

  constructor(basketId: string, intoBasketId: string, customerId: string, occurredAt: Date) {
    this.basketId = basketId;
    this.intoBasketId = intoBasketId;
    this.customerId = customerId;
    this.occurredAt = occurredAt;
  }
}
