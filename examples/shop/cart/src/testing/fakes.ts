// Fakes for the ports: a repository in a map, a sessions port that says yes or
// no, a pricing port that sums the lines. What the use cases do to them is
// what the tests assert, faster and no less honestly than a database would.
import type { Basket } from "../domain/basket/basket.ts";
import type { BasketEvent } from "../domain/basket/events/index.ts";
import type { BasketRepository } from "../domain/basket/port.ts";
import type { Pricing, Sessions } from "../application/basket/usecases/checkout/usecase.ts";
import type { LineItem } from "../domain/basket/vo/line-item.ts";
import { Money } from "../domain/basket/vo/money.ts";

export class MemoryBaskets implements BasketRepository {
  readonly baskets = new Map<string, Basket>();
  readonly published: BasketEvent[] = [];

  async byId(id: string): Promise<Basket | null> {
    return this.baskets.get(id) ?? null;
  }
  async openFor(customerId: string): Promise<Basket | null> {
    return [...this.baskets.values()].find((b) => b.customerId === customerId && b.status === "open") ?? null;
  }
  async idleSince(before: Date, limit: number): Promise<Basket[]> {
    return [...this.baskets.values()].filter((b) => b.status === "open" && b.touchedAt < before).slice(0, limit);
  }
  async save(basket: Basket, ...events: BasketEvent[]): Promise<void> {
    this.baskets.set(basket.id, basket);
    this.published.push(...events);
    basket.version += 1;
  }
}

export const vouches = (userId: string): Sessions => ({ validate: async () => ({ userId }) });
export const refuses = (): Sessions => ({ validate: async () => null });

export const sums: Pricing = {
  async quote(basketId: string, lines: LineItem[]) {
    const [first, ...rest] = lines;
    if (!first) throw new Error("nothing to price");
    return { quoteId: `q-${basketId}`, total: rest.reduce((s, l) => s.add(l.unitPrice.times(l.quantity)), first.unitPrice.times(first.quantity)) };
  },
};

export const at = (iso: string) => () => new Date(iso);
export const ids = (...list: string[]) => {
  const queue = [...list];
  return () => queue.shift() ?? `id-${Math.random()}`;
};
export const money = (amountMinor: number, currency = "EUR") => Money.of(amountMinor, currency);
