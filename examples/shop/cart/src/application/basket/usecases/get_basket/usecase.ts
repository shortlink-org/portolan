import { inject, injectable } from "inversify";
import { TOKENS } from "../../../../di/tokens.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";
import { holderOf, type BasketView, viewOf } from "../../shared.ts";

export interface Input {
  basketId: string;
  token: string;
}

@injectable()
export class UseCase {
  constructor(@inject(TOKENS.BasketRepository) private readonly repo: BasketRepository) {}

  async handle(input: Input): Promise<BasketView> {
    const basket = await holderOf(this.repo, input.basketId, input.token);
    return viewOf(basket);
  }
}
