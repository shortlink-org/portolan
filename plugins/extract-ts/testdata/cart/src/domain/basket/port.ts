import type { Basket } from "./basket.ts";
import type { BasketAbandoned } from "./events/basket-abandoned.ts";
import type { BasketCheckedOut } from "./events/basket-checked-out.ts";
import type { BasketCreated } from "./events/basket-created.ts";
import type { BasketItemAdded } from "./events/basket-item-added.ts";

export type BasketEvent = BasketCreated | BasketItemAdded | BasketCheckedOut | BasketAbandoned;

export interface BasketRepository {
  byId(id: string): Promise<Basket>;
  /** The customer's open basket, if there is one. */
  openFor(customerId: string): Promise<Basket | null>;
  /** Open baskets untouched since before the instant given. */
  idleSince(before: Date): Promise<Basket[]>;
  save(basket: Basket, ...events: BasketEvent[]): Promise<void>;
}
