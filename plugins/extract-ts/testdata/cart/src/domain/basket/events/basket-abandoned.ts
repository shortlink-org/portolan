/**
 * Nobody touched the basket for long enough that it is no longer anybody's.
 * @deprecated expiry is a policy now; nothing listens for this
 */
export class BasketAbandoned {
  readonly name = "cart.BasketAbandoned";
  constructor(readonly basketId: string) {}
}
