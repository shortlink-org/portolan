import { inject, injectable } from "inversify";
import { TOKENS, type Now } from "../../../../di/tokens.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";
import { holderOf, type BasketView, viewOf } from "../../shared.ts";

export interface Input {
  basketId: string;
  token: string;
  sku: string;
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Now) private readonly now: Now,
  ) {}

  async handle(input: Input): Promise<BasketView> {
    const basket = await holderOf(this.repo, input.basketId, input.token);
    const removed = basket.removeItem(input.sku, this.now());
    await this.repo.save(basket, removed);
    return viewOf(basket);
  }
}
