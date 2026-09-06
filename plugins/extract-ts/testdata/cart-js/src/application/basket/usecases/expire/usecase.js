/** @typedef {import("../../../../domain/basket/port.js").BasketRepository} BasketRepository */

/** Abandons every basket nobody has touched for a day. */
export class UseCase {
  /**
   * @param {BasketRepository} repo
   * @param {() => Date} now
   */
  constructor(repo, now) {
    this.repo = repo;
    this.now = now;
  }

  /** @returns {Promise<number>} */
  async handle() {
    const idle = await this.repo.idleSince(new Date(this.now().getTime() - 86_400_000));
    let abandoned = 0;
    for (const basket of idle) {
      const event = basket.abandon();
      await this.repo.save(basket, event);
      abandoned += 1;
    }
    return abandoned;
  }
}
