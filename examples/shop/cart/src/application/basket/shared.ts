// What the basket use cases share: finding a basket for whoever holds its
// token, and the shape they answer with.
import { timingSafeEqual } from "node:crypto";
import type { Basket } from "../../domain/basket/basket.ts";
import { BasketError } from "../../domain/basket/errors.ts";
import type { BasketRepository } from "../../domain/basket/port.ts";

export interface BasketView {
  basketId: string;
  customerId?: string;
  currency?: string;
  status: string;
  items: { sku: string; quantity: number; unitPrice: { amountMinor: number; currency: string } }[];
  subtotal?: { amountMinor: number; currency: string };
  touchedAt: string;
}

/** The basket, for the holder of its token; the same answer for absent and not yours. */
export async function holderOf(repo: BasketRepository, basketId: string, token: string): Promise<Basket> {
  const basket = await repo.byId(basketId);
  if (!basket || !sameToken(basket.token, token)) throw new BasketError("not-found", "no such basket");
  return basket;
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function viewOf(basket: Basket): BasketView {
  const subtotal = basket.subtotal();
  const view: BasketView = {
    basketId: basket.id,
    status: basket.status,
    items: basket.items.map((i) => ({ sku: i.sku, quantity: i.quantity, unitPrice: { amountMinor: i.unitPrice.amountMinor, currency: i.unitPrice.currency.code } })),
    touchedAt: basket.touchedAt.toISOString(),
  };
  if (basket.customerId !== undefined) view.customerId = basket.customerId;
  if (basket.currency) view.currency = basket.currency.code;
  if (subtotal) view.subtotal = { amountMinor: subtotal.amountMinor, currency: subtotal.currency.code };
  return view;
}
