import { Money } from "./vo/money.ts";

/** One line of the basket. */
export class BasketItem {
  constructor(
    readonly sku: string,
    readonly quantity: number,
    readonly unitPrice: Money,
  ) {}
}
