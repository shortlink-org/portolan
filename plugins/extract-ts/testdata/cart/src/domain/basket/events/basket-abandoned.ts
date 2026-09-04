/** Nobody touched the basket for long enough that it is no longer anybody's. */
export class BasketAbandoned {
  readonly name = "cart.BasketAbandoned";
  constructor(readonly basketId: string) {}
}
