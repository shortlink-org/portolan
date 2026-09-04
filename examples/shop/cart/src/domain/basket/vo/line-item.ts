import { Money } from "./money.ts";

/** What the caller asks to put in: the estate's shared shape for a line. */
export class LineItem {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: Money;

  constructor(sku: string, quantity: number, unitPrice: Money) {
    this.sku = sku;
    this.quantity = quantity;
    this.unitPrice = unitPrice;
  }
}
