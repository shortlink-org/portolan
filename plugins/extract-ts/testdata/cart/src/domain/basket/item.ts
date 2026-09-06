import { Money } from "./vo/money.ts";

/** One line of the basket. */
export class BasketItem {
  /**
   * The unit price in minor units, from before {@link Money} carried the currency.
   * @deprecated read `unitPrice` instead
   */
  readonly priceMinor: number = 0;
  constructor(
    readonly sku: string,
    readonly quantity: number,
    readonly unitPrice: Money,
  ) {}
}
