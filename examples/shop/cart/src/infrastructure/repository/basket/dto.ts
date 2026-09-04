// The wire form of the basket's events: what goes into the outbox row's
// payload. One topic per aggregate, dotted the way a NATS subject is, because
// the topic in the row is the subject on the wire and one name is enough
// (ADR cart.0008); and the event's name on the message, so subscribers
// dispatch on it.
import type { BasketEvent } from "../../../domain/basket/events/index.ts";
import { Money } from "../../../domain/basket/vo/money.ts";

export const TOPIC = "shop.cart.basket";

function money(m: Money): { amountMinor: number; currency: string } {
  return { amountMinor: m.amountMinor, currency: m.currency.code };
}

export function toWire(event: BasketEvent): Record<string, unknown> {
  switch (event.name) {
    case "cart.BasketCreated":
      return { basketId: event.basketId, customerId: event.customerId ?? null, occurredAt: event.occurredAt };
    case "cart.BasketItemAdded":
      return { basketId: event.basketId, sku: event.sku, quantity: event.quantity, unitPrice: money(event.unitPrice), occurredAt: event.occurredAt };
    case "cart.BasketItemRemoved":
      return { basketId: event.basketId, sku: event.sku, occurredAt: event.occurredAt };
    case "cart.BasketCheckedOut":
      return {
        basketId: event.basketId,
        customerId: event.customerId,
        items: event.items.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPrice: money(l.unitPrice) })),
        total: money(event.total),
        quoteId: event.quoteId,
        occurredAt: event.occurredAt,
      };
    case "cart.BasketAbandoned":
      return { basketId: event.basketId, customerId: event.customerId ?? null, idleSince: event.idleSince, occurredAt: event.occurredAt };
    case "cart.BasketMerged":
      return { basketId: event.basketId, intoBasketId: event.intoBasketId, customerId: event.customerId, occurredAt: event.occurredAt };
  }
}
