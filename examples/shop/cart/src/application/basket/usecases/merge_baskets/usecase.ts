import { inject, injectable } from "inversify";
import { TOKENS, type NewId, type NewToken, type Now } from "../../../../di/tokens.ts";
import { Basket } from "../../../../domain/basket/basket.ts";
import { BasketError } from "../../../../domain/basket/errors.ts";
import type { BasketEvent } from "../../../../domain/basket/events/index.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";
import type { Sessions } from "../checkout/usecase.ts";
import { holderOf, type BasketView, viewOf } from "../../shared.ts";

export interface Input {
  /** The customer's bearer token, confirmed with auth. */
  bearer: string;
  fromBasketId: string;
  fromToken: string;
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Sessions) private readonly sessions: Sessions,
    @inject(TOKENS.Now) private readonly now: Now,
    @inject(TOKENS.NewId) private readonly newId: NewId,
    @inject(TOKENS.NewToken) private readonly newToken: NewToken,
  ) {}

  async handle(input: Input): Promise<BasketView> {
    const session = await this.sessions.validate(input.bearer);
    if (!session) {
      throw new BasketError("not-yours", "no live session");
    }
    const from = await holderOf(this.repo, input.fromBasketId, input.fromToken);
    const now = this.now();
    const events: BasketEvent[] = [];
    let into = await this.repo.openFor(session.userId);
    if (!into) {
      const [created, event] = Basket.create(this.newId(), this.newToken(), session.userId, now);
      into = created;
      events.push(event);
    }
    // Every line or none: a refusal throws before anything is saved.
    for (const line of from.lines()) {
      events.push(into.addItem(line, now));
    }
    const merged = from.mergeInto(into, now);
    await this.repo.save(into, ...events);
    await this.repo.save(from, merged);
    return viewOf(into);
  }
}
