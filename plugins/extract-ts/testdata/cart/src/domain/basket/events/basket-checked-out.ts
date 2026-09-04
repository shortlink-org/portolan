import { Money } from "../vo/money.ts";

/** The basket is frozen; whoever places the order listens for this. */
export class BasketCheckedOut {
  readonly name = "cart.BasketCheckedOut";
  constructor(
    readonly basketId: string,
    readonly total: Money,
    readonly quoteId: string,
  ) {}
}
