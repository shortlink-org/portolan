import { inject, injectable } from "inversify";
import { TOKENS, type Now } from "../../../../di/tokens.ts";
import { BasketError } from "../../../../domain/basket/errors.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";
import type { LineItem } from "../../../../domain/basket/vo/line-item.ts";
import type { Money } from "../../../../domain/basket/vo/money.ts";

/**
 * Somebody who can say whether a bearer token is a live session, and whose.
 * Declared here, by the code that needs it, so that this package does not
 * import the client that satisfies it; assembly hands in the adapter over
 * auth's HTTP API.
 */
export interface Sessions {
  validate(bearer: string): Promise<{ userId: string } | null>;
}

/** Somebody who can price the lines: the quote the customer will be charged. */
export interface Pricing {
  quote(basketId: string, lines: LineItem[]): Promise<{ quoteId: string; total: Money }>;
}

export interface Input {
  basketId: string;
  bearer: string;
}

export interface Output {
  basketId: string;
  quoteId: string;
  total: { amountMinor: number; currency: string };
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Sessions) private readonly sessions: Sessions,
    @inject(TOKENS.Pricing) private readonly pricing: Pricing,
    @inject(TOKENS.Now) private readonly now: Now,
  ) {}

  async handle(input: Input): Promise<Output> {
    const session = await this.sessions.validate(input.bearer);
    if (!session) {
      throw new BasketError("not-yours", "no live session");
    }
    const basket = await this.repo.byId(input.basketId);
    if (!basket) {
      throw new BasketError("not-found", "no such basket");
    }
    if (basket.customerId !== undefined && basket.customerId !== session.userId) {
      throw new BasketError("not-yours", "not this customer's basket");
    }
    const quote = await this.pricing.quote(basket.id, basket.lines());
    const checkedOut = basket.checkout(session.userId, quote.total, quote.quoteId, this.now());
    await this.repo.save(basket, checkedOut);
    return { basketId: basket.id, quoteId: quote.quoteId, total: { amountMinor: quote.total.amountMinor, currency: quote.total.currency.code } };
  }
}
