import type { Basket } from "./basket.ts";
import type { BasketCheckedOut } from "./events/basket-checked-out.ts";
import type { BasketItemAdded } from "./events/basket-item-added.ts";

export interface BasketRepository {
  byId(id: string): Promise<Basket>;
  save(basket: Basket, ...events: (BasketItemAdded | BasketCheckedOut)[]): Promise<void>;
}
