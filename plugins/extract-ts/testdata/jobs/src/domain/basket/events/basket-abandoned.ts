/** Nobody touched the basket for a day. */
export class BasketAbandoned {
  readonly name = "cart.BasketAbandoned";
  constructor(readonly basketId: string) {}
}
