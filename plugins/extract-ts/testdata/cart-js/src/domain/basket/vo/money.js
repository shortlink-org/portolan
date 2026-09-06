/** An amount in the minor unit of a currency. */
export class Money {
  /**
   * @param {number} amountMinor
   * @param {string} currency
   */
  constructor(amountMinor, currency) {
    this.amountMinor = amountMinor;
    this.currency = currency;
  }
}
