import type { BasketRepository } from "../../../../domain/basket/port.ts";
import { Money } from "../../../../domain/basket/vo/money.ts";

export interface Input {
  basketId: string;
  sku: string;
  quantity: number;
  unitPrice: Money;
}

/** Adds a line, or increments one already there. */
export class UseCase {
  constructor(
    private readonly repo: BasketRepository,
    private readonly now: () => Date,
  ) {}

  async handle(input: Input): Promise<void> {
    const basket = await this.repo.byId(input.basketId);
    const added = basket.addItem(input.sku, input.quantity, input.unitPrice);
    await this.repo.save(basket, added);
  }
}
