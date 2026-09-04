import { BasketAbandoned } from "./events/basket-abandoned.ts";
import { BasketCheckedOut } from "./events/basket-checked-out.ts";
import { BasketCreated } from "./events/basket-created.ts";
import { BasketItemAdded } from "./events/basket-item-added.ts";
import { Money } from "./vo/money.ts";
import { BasketItem } from "./item.ts";

/** A visitor's or a customer's lines, under one lock. */
export class Basket {
  readonly items: BasketItem[] = [];
  status: "open" | "checked-out" | "abandoned" = "open";
  constructor(
    readonly id: string,
    readonly token: string,
    public currency: string | undefined,
    public version: number,
  ) {}

  static create(id: string, token: string, customerId?: string): [Basket, BasketCreated] {
    return [new Basket(id, token, undefined, 0), new BasketCreated(id, customerId)];
  }

  addItem(sku: string, quantity: number, unitPrice: Money): BasketItemAdded {
    this.items.push(new BasketItem(sku, quantity, unitPrice));
    return new BasketItemAdded(this.id, sku, quantity, unitPrice);
  }

  lines(): BasketItem[] {
    return [...this.items];
  }

  checkout(total: Money, quoteId: string): BasketCheckedOut {
    this.status = "checked-out";
    return new BasketCheckedOut(this.id, total, quoteId);
  }

  abandon(): BasketAbandoned {
    this.status = "abandoned";
    return new BasketAbandoned(this.id);
  }
}
