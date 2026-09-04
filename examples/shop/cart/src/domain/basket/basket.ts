import { BasketError } from "./errors.ts";
import { BasketAbandoned } from "./events/basket-abandoned.ts";
import { BasketCheckedOut } from "./events/basket-checked-out.ts";
import { BasketCreated } from "./events/basket-created.ts";
import { BasketItemAdded } from "./events/basket-item-added.ts";
import { BasketItemRemoved } from "./events/basket-item-removed.ts";
import { BasketMerged } from "./events/basket-merged.ts";
import { BasketItem } from "./item.ts";
import { whyNotAdd } from "./rules/index.ts";
import { EDITABLE, canMove, type BasketStatus } from "./status.ts";
import type { Currency } from "./vo/currency.ts";
import { LineItem } from "./vo/line-item.ts";
import { Money } from "./vo/money.ts";

export type { BasketStatus } from "./status.ts";

/**
 * Basket is the aggregate root: a visitor's or a customer's lines, their
 * currency and their state, decided under one lock. Every method that changes
 * it answers with the fact, and publishing is the caller's business. Where
 * it can go from where it is, `status.ts` says in one table; `moveTo` is the
 * only way through it.
 */
export class Basket {
  readonly id: string;
  /** The capability to change an anonymous basket (cart.0007). */
  readonly token: string;
  customerId: string | undefined;
  /** Set by the first line, never changed (cart.0002). */
  currency: Currency | undefined;
  status: BasketStatus;
  readonly items: BasketItem[];
  touchedAt: Date;
  /** Bumped by every write; a write from a stale read is refused. */
  version: number;

  constructor(id: string, token: string, customerId: string | undefined, currency: Currency | undefined, status: BasketStatus, items: BasketItem[], touchedAt: Date, version: number) {
    this.id = id;
    this.token = token;
    this.customerId = customerId;
    this.currency = currency;
    this.status = status;
    this.items = items;
    this.touchedAt = touchedAt;
    this.version = version;
  }

  static create(id: string, token: string, customerId: string | undefined, now: Date): [Basket, BasketCreated] {
    const basket = new Basket(id, token, customerId, undefined, "open", [], now, 0);
    return [basket, new BasketCreated(id, customerId, now)];
  }

  /** Puts a line in, or grows the one already there, under the rules in `rules/`. */
  addItem(line: LineItem, now: Date): BasketItemAdded {
    this.mustBeEditable();
    const existing = this.items.find((i) => i.sku === line.sku);
    const why = whyNotAdd(line, {
      currency: this.currency,
      distinct: this.items.length,
      already: existing?.quantity ?? 0,
      isNew: existing === undefined,
    });
    if (why) throw new BasketError("refused", why);

    let quantity: number;
    if (existing) {
      existing.quantity += line.quantity;
      quantity = existing.quantity;
    } else {
      this.items.push(new BasketItem(line.sku, line.quantity, line.unitPrice));
      quantity = line.quantity;
    }
    this.currency ??= line.unitPrice.currency;
    this.touchedAt = now;
    return new BasketItemAdded(this.id, line.sku, quantity, line.unitPrice, now);
  }

  /** Takes a line out outright. */
  removeItem(sku: string, now: Date): BasketItemRemoved {
    this.mustBeEditable();
    const at = this.items.findIndex((i) => i.sku === sku);
    if (at < 0) throw new BasketError("not-found", `no line for ${sku}`);
    this.items.splice(at, 1);
    if (this.items.length === 0) this.currency = undefined;
    this.touchedAt = now;
    return new BasketItemRemoved(this.id, sku, now);
  }

  /** Freezes the basket against the quote pricing gave for it (cart.0004). */
  checkout(customerId: string, total: Money, quoteId: string, now: Date): BasketCheckedOut {
    if (this.items.length === 0) throw new BasketError("refused", "an empty basket cannot be checked out");
    this.moveTo("checked-out", now);
    this.customerId = customerId;
    return new BasketCheckedOut(this.id, customerId, this.lines(), total, quoteId, now);
  }

  /** Marks the basket as left behind (cart.0006). */
  abandon(now: Date): BasketAbandoned {
    const idleSince = this.touchedAt;
    this.moveTo("abandoned", now);
    return new BasketAbandoned(this.id, this.customerId, idleSince, now);
  }

  /**
   * The visitor's basket, once its lines have moved into the customer's
   * (cart.0005). Moving the lines is the caller's job, under `addItem`'s own
   * rules on the other basket; this is the record that it happened.
   */
  mergeInto(into: Basket, now: Date): BasketMerged {
    if (into.customerId === undefined) throw new BasketError("refused", "a basket merges into a customer's basket, not a visitor's");
    this.moveTo("merged", now);
    return new BasketMerged(this.id, into.id, into.customerId, now);
  }

  /** The lines as the estate's shared shape. */
  lines(): LineItem[] {
    return this.items.map((i) => new LineItem(i.sku, i.quantity, i.unitPrice));
  }

  /** The sum of the lines, or nothing for an empty basket: the total is pricing's (cart.0003). */
  subtotal(): Money | undefined {
    const [first, ...rest] = this.items;
    if (!first) return undefined;
    return rest.reduce((sum, i) => sum.add(i.total()), first.total());
  }

  /** The one way the status changes: through the table in `status.ts`. */
  private moveTo(next: BasketStatus, now: Date): void {
    if (!canMove(this.status, next)) throw new BasketError("not-open", `a ${this.status} basket cannot become ${next}`);
    this.status = next;
    this.touchedAt = now;
  }

  private mustBeEditable(): void {
    if (!EDITABLE.includes(this.status)) throw new BasketError("not-open", `the basket is ${this.status}`);
  }
}
