import { Basket } from "../../../../domain/basket/basket.js";
import { holderOf } from "../../shared.js";

/** @typedef {import("../../../../domain/basket/port.js").BasketEvent} BasketEvent */
/** @typedef {import("../../../../domain/basket/port.js").BasketRepository} BasketRepository */
/** @typedef {import("../checkout/usecase.js").Sessions} Sessions */

/**
 * @typedef {Object} Input
 * @property {string} bearer
 * @property {string} fromBasketId
 * @property {string} fromToken
 */

/**
 * Folds a visitor's basket into the customer's own, making one if there is none.
 * @deprecated sessions are merged at sign-in now
 */
export class UseCase {
  /**
   * @param {BasketRepository} repo
   * @param {Sessions} sessions
   * @param {() => string} newId
   */
  constructor(repo, sessions, newId) {
    this.repo = repo;
    this.sessions = sessions;
    this.newId = newId;
  }

  /**
   * @param {Input} input
   * @returns {Promise<void>}
   */
  async handle(input) {
    const session = await this.sessions.validate(input.bearer);
    if (!session) {
      throw new Error("no live session");
    }
    const from = await holderOf(this.repo, input.fromBasketId, input.fromToken);
    /** @type {BasketEvent[]} */
    const events = [];
    let into = await this.repo.openFor(session.userId);
    if (!into) {
      const [created, event] = Basket.create(this.newId(), this.newId(), session.userId);
      into = created;
      events.push(event);
    }
    for (const line of from.lines()) {
      events.push(into.addItem(line.sku, line.quantity, line.unitPrice));
    }
    await this.repo.save(into, ...events);
    await this.repo.save(from);
  }
}
