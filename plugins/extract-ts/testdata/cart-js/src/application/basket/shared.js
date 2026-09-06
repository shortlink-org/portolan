/** @typedef {import("../../domain/basket/basket.js").Basket} Basket */
/** @typedef {import("../../domain/basket/port.js").BasketRepository} BasketRepository */

/**
 * The basket behind an id, once the token presented is the one it was issued with.
 * @param {BasketRepository} repo
 * @param {string} basketId
 * @param {string} token
 * @returns {Promise<Basket>}
 */
export async function holderOf(repo, basketId, token) {
  const basket = await repo.byId(basketId);
  if (basket.token !== token) throw new Error("not yours");
  return basket;
}
