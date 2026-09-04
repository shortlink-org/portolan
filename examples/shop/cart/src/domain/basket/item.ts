import { Money } from "./vo/money.ts";

/** One line: a SKU, how many, and what each one cost when it went in. */
export class BasketItem {
  readonly sku: string;
  quantity: number;
  readonly unitPrice: Money;

  constructor(sku: string, quantity: number, unitPrice: Money) {
    this.sku = sku;
    this.quantity = quantity;
    this.unitPrice = unitPrice;
  }

  total(): Money {
    return this.unitPrice.times(this.quantity);
  }
}
