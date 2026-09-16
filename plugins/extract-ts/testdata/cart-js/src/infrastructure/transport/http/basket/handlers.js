import { z } from "zod";

/** @typedef {import("@app/basket/usecases/add_item/usecase.js").UseCase} AddItem */
/** @typedef {import("@app/basket/usecases/checkout/usecase.js").UseCase} Checkout */
/** @typedef {import("@app/basket/usecases/expire/usecase.js").UseCase} Expire */
/** @typedef {import("@app/basket/usecases/merge/usecase.js").UseCase} Merge */

const money = z.object({ amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) });
const basketParams = z.object({ basketId: z.string().uuid() });
const addItemBody = z.object({ sku: z.string().min(1), quantity: z.number().int().min(1).max(99), unitPrice: money });
const mergeBody = z.object({ fromBasketId: z.string().uuid(), fromToken: z.string().min(1).describe("the token the basket being merged in is held by") });

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
   * @param {{ params: unknown; body: unknown }} req
   * @returns {Promise<void>}
   */
  async addItem(req) {
    const { basketId } = basketParams.parse(req.params);
    const body = addItemBody.parse(req.body);
    await this.addItemUseCase.handle({ basketId, sku: body.sku, quantity: body.quantity, unitPrice: /** @type {never} */ (body.unitPrice) });
  }

  /**
   * @param {{ basketId: string; token: string }} req
   * @returns {Promise<{ quoteId: string }>}
   */
  async checkout(req) {
    return this.checkoutUseCase.handle({ basketId: req.basketId, token: req.token });
  }

  /**
   * @param {{ bearer: string; body: unknown }} req
   * @returns {Promise<void>}
   */
  async mergeBaskets(req) {
    const body = mergeBody.parse(req.body);
    await this.mergeUseCase.handle({ bearer: req.bearer, fromBasketId: body.fromBasketId, fromToken: body.fromToken });
  }

  /** @returns {Promise<number>} */
  async expireIdleBaskets() {
    return this.expireUseCase.handle();
  }
}
