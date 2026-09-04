/** A basket came into being, for a visitor or for a customer. */
export class BasketCreated {
  readonly name = "cart.BasketCreated";
  constructor(
    readonly basketId: string,
    readonly customerId: string | undefined,
  ) {}
}
