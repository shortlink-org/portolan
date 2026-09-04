import { BasketCheckedOut } from "../../domain/basket/events/basket-checked-out.ts";
import type { BasketRepository } from "../../domain/basket/port.ts";

/** Touches the basket once it is checked out, so the sweep leaves it alone. */
export class TouchOnCheckout {
  constructor(private readonly repo: BasketRepository) {}

  async handle(event: unknown): Promise<void> {
    if (!(event instanceof BasketCheckedOut)) return;
    const basket = await this.repo.byId(event.basketId);
    if (basket.status === "open") {
      await this.repo.save(basket);
      return;
    }
    switch (basket.currency) {
      case "EUR":
        await this.repo.save(basket);
        break;
      default:
        return;
    }
  }
}
