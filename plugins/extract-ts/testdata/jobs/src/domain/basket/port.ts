import type { Basket } from "./basket.ts";
import type { BasketAbandoned } from "./events/basket-abandoned.ts";

export interface BasketRepository {
  idleSince(before: Date): Promise<Basket[]>;
  save(basket: Basket, ...events: BasketAbandoned[]): Promise<void>;
}
