import type { Basket } from "../../domain/basket/basket.ts";
import type { BasketRepository } from "../../domain/basket/port.ts";

/** The basket behind an id, once the token presented is the one it was issued with. */
export async function holderOf(repo: BasketRepository, basketId: string, token: string): Promise<Basket> {
  const basket = await repo.byId(basketId);
  if (basket.token !== token) throw new Error("not yours");
  return basket;
}
