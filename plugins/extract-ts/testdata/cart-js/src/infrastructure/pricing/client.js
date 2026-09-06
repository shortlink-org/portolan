import { createClient } from "@connectrpc/connect";
import { Pricing } from "./gen/shop/v1/pricing_pb.js";
import { Money } from "../../domain/basket/vo/money.js";

/** @typedef {import("../../application/basket/usecases/checkout/usecase.js").Pricing} PricingPort */

/**
 * Pricing over its gRPC API.
 * @implements {PricingPort}
 */
export class PricingClient {
  /** @param {unknown} transport */
  constructor(transport) {
    /** @type {import("@connectrpc/connect").Client<typeof Pricing>} */
    this.client = createClient(Pricing, /** @type {never} */ (transport));
  }

  /**
   * @param {string} basketId
   * @returns {Promise<{ quoteId: string; total: Money }>}
   */
  async quote(basketId) {
    const res = await this.client.getQuote({ basketId });
    return { quoteId: res.quoteId, total: new Money(Number(res.totalMinor), res.currency) };
  }
}
