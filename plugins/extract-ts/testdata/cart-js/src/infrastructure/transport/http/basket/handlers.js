/** @typedef {import("@app/basket/usecases/add_item/usecase.js").UseCase} AddItem */
/** @typedef {import("@app/basket/usecases/checkout/usecase.js").UseCase} Checkout */
/** @typedef {import("@app/basket/usecases/expire/usecase.js").UseCase} Expire */
/** @typedef {import("@app/basket/usecases/merge/usecase.js").UseCase} Merge */

export class BasketHandlers {
  /**
   * @param {AddItem} addItemUseCase
   * @param {Checkout} checkoutUseCase
   * @param {Merge} mergeUseCase
   * @param {Expire} expireUseCase
   */
  constructor(addItemUseCase, checkoutUseCase, mergeUseCase, expireUseCase) {
    this.addItemUseCase = addItemUseCase;
    this.checkoutUseCase = checkoutUseCase;
    this.mergeUseCase = mergeUseCase;
    this.expireUseCase = expireUseCase;
  }

  /**
   * @param {{ basketId: string; body: { sku: string; quantity: number; unitPrice: { amountMinor: number; currency: string } } }} req
   * @returns {Promise<void>}
   */
  async addItem(req) {
    await this.addItemUseCase.handle({ basketId: req.basketId, sku: req.body.sku, quantity: req.body.quantity, unitPrice: /** @type {never} */ (req.body.unitPrice) });
  }

  /**
   * @param {{ basketId: string; token: string }} req
   * @returns {Promise<{ quoteId: string }>}
   */
  async checkout(req) {
    return this.checkoutUseCase.handle({ basketId: req.basketId, token: req.token });
  }

  /**
   * @param {{ bearer: string; body: { fromBasketId: string; fromToken: string } }} req
   * @returns {Promise<void>}
   */
  async mergeBaskets(req) {
    await this.mergeUseCase.handle({ bearer: req.bearer, fromBasketId: req.body.fromBasketId, fromToken: req.body.fromToken });
  }

  /** @returns {Promise<number>} */
  async expireIdleBaskets() {
    return this.expireUseCase.handle();
  }
}
