import { Money } from "../../../../domain/basket/vo/money.js";

/** @typedef {import("../../../../domain/basket/port.js").BasketRepository} BasketRepository */

/**
 * @typedef {Object} Input
 * @property {string} basketId
 * @property {string} sku
 * @property {number} quantity
 * @property {Money} unitPrice
 */

/** Adds a line, or increments one already there. */
export class UseCase {
  /**
   * @param {BasketRepository} repo
   * @param {() => Date} now
   */
  constructor(repo, now) {
    this.repo = repo;
    this.now = now;
  }

  /**
   * @param {Input} input
   * @returns {Promise<void>}
   */
  async handle(input) {
    const basket = await this.repo.byId(input.basketId);
    const added = basket.addItem(input.sku, input.quantity, input.unitPrice);
    await this.repo.save(basket, added);
  }
}
