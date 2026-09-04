import { inject, injectable } from "inversify";
import { TOKENS, type Now } from "../../../../di/tokens.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";
import { LineItem } from "../../../../domain/basket/vo/line-item.ts";
import { Money } from "../../../../domain/basket/vo/money.ts";
import { holderOf, type BasketView, viewOf } from "../../shared.ts";

export interface Input {
  basketId: string;
  token: string;
  sku: string;
  quantity: number;
  unitPrice: { amountMinor: number; currency: string };
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Now) private readonly now: Now,
  ) {}

  async handle(input: Input): Promise<BasketView> {
    const basket = await holderOf(this.repo, input.basketId, input.token);
    const line = new LineItem(input.sku, input.quantity, Money.of(input.unitPrice.amountMinor, input.unitPrice.currency));
    const added = basket.addItem(line, this.now());
    await this.repo.save(basket, added);
    return viewOf(basket);
  }
}
