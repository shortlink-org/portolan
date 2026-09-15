import { inject, injectable } from "inversify";
import { TOKENS, type Now } from "../../../../di/tokens.ts";
import { BasketError } from "../../../../domain/basket/errors.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";
import type { LineItem } from "../../../../domain/basket/vo/line-item.ts";
import type { Money } from "../../../../domain/basket/vo/money.ts";
import { holderOf, type BasketView, viewOf } from "../../shared.ts";

/**
 * Somebody who can say whether a coupon is good for these lines, and for how
 * much. Declared here, by the code that needs it; assembly hands in the
 * adapter over pricing's API.
 */
export interface Coupons {
  redeem(basketId: string, code: string, lines: LineItem[]): Promise<{ code: string; discount: Money } | null>;
}

export interface Input {
  basketId: string;
  token: string;
  code: string;
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Coupons) private readonly coupons: Coupons,
    @inject(TOKENS.Now) private readonly now: Now,
  ) {}

  async handle(input: Input): Promise<BasketView> {
    const basket = await holderOf(this.repo, input.basketId, input.token);
    const redeemed = await this.coupons.redeem(basket.id, input.code, basket.lines());
    if (!redeemed) {
      throw new BasketError("refused", "the coupon was not accepted");
    }
    const applied = basket.applyCoupon(redeemed.code, redeemed.discount, this.now());
    await this.repo.save(basket, applied);
    return viewOf(basket);
  }
}
