import type { BasketRepository } from "../../../../domain/basket/port.ts";

/** Abandons every basket nobody has touched for a day. */
export class UseCase {
  constructor(
    private readonly repo: BasketRepository,
    private readonly now: () => Date,
  ) {}

  async handle(): Promise<void> {
    const idle = await this.repo.idleSince(new Date(this.now().getTime() - 86_400_000));
    for (const basket of idle) {
      const event = basket.abandon();
      await this.repo.save(basket, event);
    }
  }
}
