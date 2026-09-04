import type { Basket } from "./basket.ts";
import type { BasketEvent } from "./events/index.ts";

/**
 * Where baskets are kept. `save` writes the basket and the events it hands
 * over in one transaction - the events into the outbox - and refuses a
 * basket whose version is not the one it was read at.
 */
export interface BasketRepository {
  byId(id: string): Promise<Basket | null>;
  /** The customer's open basket, if there is one. */
  openFor(customerId: string): Promise<Basket | null>;
  /** Open baskets untouched since before the instant given. */
  idleSince(before: Date, limit: number): Promise<Basket[]>;
  save(basket: Basket, ...events: BasketEvent[]): Promise<void>;
}
