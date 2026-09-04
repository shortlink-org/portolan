import { inject, injectable } from "inversify";
import { Basket } from "../../../../domain/basket/basket.ts";
import type { BasketEvent, BasketRepository } from "../../../../domain/basket/port.ts";
import { TOKENS } from "../../../../di/tokens.ts";
import type { Sessions } from "../checkout/usecase.ts";
import { holderOf } from "../../shared.ts";

export interface Input {
  bearer: string;
  fromBasketId: string;
  fromToken: string;
}

/** Folds a visitor's basket into the customer's own, making one if there is none. */
@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Sessions) private readonly sessions: Sessions,
    @inject(TOKENS.NewId) private readonly newId: () => string,
  ) {}

  async handle(input: Input): Promise<void> {
    const session = await this.sessions.validate(input.bearer);
    if (!session) {
      throw new Error("no live session");
    }
    const from = await holderOf(this.repo, input.fromBasketId, input.fromToken);
    const events: BasketEvent[] = [];
    let into = await this.repo.openFor(session.userId);
    if (!into) {
      const [created, event] = Basket.create(this.newId(), this.newId(), session.userId);
      into = created;
      events.push(event);
    }
    for (const line of from.lines()) {
      events.push(into.addItem(line.sku, line.quantity, line.unitPrice));
    }
    await this.repo.save(into, ...events);
    await this.repo.save(from);
  }
}
