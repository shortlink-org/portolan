/** A basket came into being, for a visitor or for a customer. */
export class BasketCreated {
  name = "cart.BasketCreated";
  /**
   * @param {string} basketId
   * @param {string | undefined} customerId
   */
  constructor(basketId, customerId) {
    this.basketId = basketId;
    this.customerId = customerId;
  }
}
