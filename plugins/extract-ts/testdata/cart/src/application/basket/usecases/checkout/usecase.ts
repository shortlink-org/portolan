import { inject, injectable } from "inversify";
import type { BasketRepository } from "../../../../domain/basket/port.ts";
import type { Money } from "../../../../domain/basket/vo/money.ts";
import { TOKENS } from "../../../../di/tokens.ts";

/** Somebody who can say whether a bearer token is a live session. */
export interface Sessions {
  validate(token: string): Promise<{ userId: string } | null>;
}

/** Somebody who can price the lines. */
export interface Pricing {
  quote(basketId: string): Promise<{ quoteId: string; total: Money }>;
}

export interface Input {
  basketId: string;
  token: string;
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Sessions) private readonly sessions: Sessions,
    @inject(TOKENS.Pricing) private readonly pricing: Pricing,
  ) {}

  async handle(input: Input): Promise<{ quoteId: string }> {
    const session = await this.sessions.validate(input.token);
    if (!session) {
      throw new Error("no live session");
    }
    const basket = await this.repo.byId(input.basketId);
    if (basket.items.length === 0) {
      throw new Error("empty");
    }
    const quote = await this.pricing.quote(basket.id);
    const checkedOut = basket.checkout(quote.total, quote.quoteId);
    await this.repo.save(basket, checkedOut);
    return { quoteId: quote.quoteId };
  }
}
