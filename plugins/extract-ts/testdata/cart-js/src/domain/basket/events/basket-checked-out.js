import { Money } from "../vo/money.js";

/** The basket is frozen; whoever places the order listens for this. */
export class BasketCheckedOut {
  name = "cart.BasketCheckedOut";
  /**
   * @param {string} basketId
   * @param {Money} total
   * @param {string} quoteId
   */
  constructor(basketId, total, quoteId) {
    this.basketId = basketId;
    this.total = total;
    this.quoteId = quoteId;
  }
}
