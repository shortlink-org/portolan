import { Money } from "./vo/money.js";

/** One line of the basket. */
export class BasketItem {
  /**
   * The unit price in minor units, from before {@link Money} carried the currency.
   * @deprecated read `unitPrice` instead
   * @type {number}
   */
  priceMinor = 0;
  /**
   * @param {string} sku
   * @param {number} quantity
   * @param {Money} unitPrice
   */
  constructor(sku, quantity, unitPrice) {
    this.sku = sku;
    this.quantity = quantity;
    this.unitPrice = unitPrice;
  }
}
