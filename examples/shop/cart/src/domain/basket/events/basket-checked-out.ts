import { LineItem } from "../vo/line-item.ts";
import { Money } from "../vo/money.ts";

/**
 * The basket is frozen. This is the handoff: whoever places the order listens
 * for it, and pricing expires the quote it issued.
 */
export class BasketCheckedOut {
  readonly name = "cart.BasketCheckedOut";
  readonly basketId: string;
  readonly customerId: string;
  readonly items: LineItem[];
  readonly total: Money;
  readonly quoteId: string;
  readonly occurredAt: Date;

  constructor(basketId: string, customerId: string, items: LineItem[], total: Money, quoteId: string, occurredAt: Date) {
    this.basketId = basketId;
    this.customerId = customerId;
    this.items = items;
    this.total = total;
    this.quoteId = quoteId;
    this.occurredAt = occurredAt;
  }
}
