// A port in JavaScript is a typedef: there is no interface to export, so the
// shape is written in the comment and the module exports nothing.

/** @typedef {import("./basket.js").Basket} Basket */
/** @typedef {import("./events/basket-abandoned.js").BasketAbandoned} BasketAbandoned */
/** @typedef {import("./events/basket-checked-out.js").BasketCheckedOut} BasketCheckedOut */
/** @typedef {import("./events/basket-created.js").BasketCreated} BasketCreated */
/** @typedef {import("./events/basket-item-added.js").BasketItemAdded} BasketItemAdded */

/** @typedef {BasketCreated | BasketItemAdded | BasketCheckedOut | BasketAbandoned} BasketEvent */

/**
 * @typedef {Object} BasketRepository
 * @property {(id: string) => Promise<Basket>} byId
 * @property {(customerId: string) => Promise<Basket | null>} openFor The customer's open basket, if there is one.
 * @property {(before: Date) => Promise<Basket[]>} idleSince Open baskets untouched since before the instant given.
 * @property {(basket: Basket, ...events: BasketEvent[]) => Promise<void>} save
 */

export {};
