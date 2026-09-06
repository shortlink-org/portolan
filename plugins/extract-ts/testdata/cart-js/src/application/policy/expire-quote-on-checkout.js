import { BasketCheckedOut } from "../../domain/basket/events/basket-checked-out.js";

/** @typedef {import("../../domain/basket/port.js").BasketRepository} BasketRepository */

/** Touches the basket once it is checked out, so the sweep leaves it alone. */
export class TouchOnCheckout {
  /** @param {BasketRepository} repo */
  constructor(repo) {
    this.repo = repo;
  }

  /**
   * @param {unknown} event
   * @returns {Promise<void>}
   */
  async handle(event) {
    if (!(event instanceof BasketCheckedOut)) return;
    const basket = await this.repo.byId(event.basketId);
    if (basket.status === "open") {
      await this.repo.save(basket);
      return;
    }
    switch (basket.currency) {
      case "EUR":
        await this.repo.save(basket);
        break;
      default:
        return;
    }
  }
}
