import { Money } from "../vo/money.js";

/** A line went in, or grew. */
export class BasketItemAdded {
  name = "cart.BasketItemAdded";
  /**
   * @param {string} basketId
   * @param {string} sku
   * @param {number} quantity
   * @param {Money} unitPrice
   */
  constructor(basketId, sku, quantity, unitPrice) {
    this.basketId = basketId;
    this.sku = sku;
    this.quantity = quantity;
    this.unitPrice = unitPrice;
  }
}
