import { BasketAbandoned } from "./events/basket-abandoned.js";
import { BasketCheckedOut } from "./events/basket-checked-out.js";
import { BasketCreated } from "./events/basket-created.js";
import { BasketItemAdded } from "./events/basket-item-added.js";
import { Money } from "./vo/money.js";
import { BasketItem } from "./item.js";
import { canMove } from "./status.js";

/** @typedef {import("./status.js").BasketStatus} BasketStatus */

/**
 * A visitor's or a customer's lines, under one lock.
 *
 * @remarks
 * Each line is a {@link BasketItem}; the price on it is a {@link Money | money value}.
 * @example
 * const [basket] = Basket.create(id, token);
 * basket.addItem("sku-1", 2, new Money(500, "EUR"));
 * @see {@link BasketCheckedOut}
 */
export class Basket {
  /** @type {BasketItem[]} */
  items = [];
  /** @type {BasketStatus} */
  status = "open";
  /**
   * @param {string} id
   * @param {string} token
   * @param {string | undefined} currency
   * @param {number} version
   */
  constructor(id, token, currency, version) {
    this.id = id;
    this.token = token;
    this.currency = currency;
    this.version = version;
  }

  /**
   * @param {string} id
   * @param {string} token
   * @param {string} [customerId]
   * @returns {[Basket, BasketCreated]}
   */
  static create(id, token, customerId) {
    return [new Basket(id, token, undefined, 0), new BasketCreated(id, customerId)];
  }

  /**
   * @param {string} sku
   * @param {number} quantity
   * @param {Money} unitPrice
   * @returns {BasketItemAdded}
   */
  addItem(sku, quantity, unitPrice) {
    this.items.push(new BasketItem(sku, quantity, unitPrice));
    return new BasketItemAdded(this.id, sku, quantity, unitPrice);
  }

  /** @returns {BasketItem[]} */
  lines() {
    return [...this.items];
  }

  /**
   * @param {Money} total
   * @param {string} quoteId
   * @returns {BasketCheckedOut}
   */
  checkout(total, quoteId) {
    this.moveTo("checked-out");
    return new BasketCheckedOut(this.id, total, quoteId);
  }

  /** @returns {BasketAbandoned} */
  abandon() {
    this.moveTo("abandoned");
    return new BasketAbandoned(this.id);
  }

  /**
   * @param {BasketStatus} next
   * @returns {void}
   */
  moveTo(next) {
    if (!canMove(this.status, next)) throw new Error(`a ${this.status} basket cannot become ${next}`);
    this.status = next;
  }
}
