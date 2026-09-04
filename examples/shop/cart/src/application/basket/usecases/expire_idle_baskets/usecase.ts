import { inject, injectable } from "inversify";
import { TOKENS, type Now } from "../../../../di/tokens.ts";
import type { BasketRepository } from "../../../../domain/basket/port.ts";

export const IDLE_FOR_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

export interface Output {
  abandoned: number;
}

@injectable()
export class UseCase {
  constructor(
    @inject(TOKENS.BasketRepository) private readonly repo: BasketRepository,
    @inject(TOKENS.Now) private readonly now: Now,
  ) {}

  async handle(): Promise<Output> {
    const now = this.now();
    const idle = await this.repo.idleSince(new Date(now.getTime() - IDLE_FOR_MS), BATCH);
    let abandoned = 0;
    for (const basket of idle) {
      const event = basket.abandon(now);
      await this.repo.save(basket, event);
      abandoned += 1;
    }
    return { abandoned };
  }
}
