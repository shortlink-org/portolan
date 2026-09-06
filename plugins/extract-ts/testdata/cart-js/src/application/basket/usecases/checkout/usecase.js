
/** @typedef {import("../../../../domain/basket/port.js").BasketRepository} BasketRepository */
/** @typedef {import("../../../../domain/basket/vo/money.js").Money} Money */

/**
 * Somebody who can say whether a bearer token is a live session.
 * @typedef {{ validate(token: string): Promise<{ userId: string } | null> }} Sessions
 */

/**
 * Somebody who can price the lines.
 * @typedef {{ quote(basketId: string): Promise<{ quoteId: string; total: Money }> }} Pricing
 */

/** @typedef {{ basketId: string; token: string }} Input */

export class UseCase {
  /**
   * @param {BasketRepository} repo
   * @param {Sessions} sessions
   * @param {Pricing} pricing
   */
  constructor(repo, sessions, pricing) {
    this.repo = repo;
    this.sessions = sessions;
    this.pricing = pricing;
  }

  /**
   * @param {Input} input
   * @returns {Promise<{ quoteId: string }>}
   */
  async handle(input) {
    const session = await this.sessions.validate(input.token);
    if (!session) {
      throw new Error("no live session");
    }
    const basket = await this.repo.byId(input.basketId);
    if (basket.items.length === 0) {
      throw new Error("empty");
    }
    const quote = await this.pricing.quote(basket.id);
    const checkedOut = basket.checkout(quote.total, quote.quoteId);
    await this.repo.save(basket, checkedOut);
    return { quoteId: quote.quoteId };
  }
}
