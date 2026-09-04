import { inject, injectable } from "inversify";
import { TOKENS, type NewId, type NewToken, type Now } from "../../../../di/tokens.ts";
import { Basket } from "../../../../domain/basket/basket.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";

export interface Output {
  basketId: string;
  token: string;
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Now) private readonly now: Now,
    @inject(TOKENS.NewId) private readonly newId: NewId,
    @inject(TOKENS.NewToken) private readonly newToken: NewToken,
  ) {}

  async handle(): Promise<Output> {
    const [basket, created] = Basket.create(this.newId(), this.newToken(), undefined, this.now());
    await this.repo.save(basket, created);
    return { basketId: basket.id, token: basket.token };
  }
}
