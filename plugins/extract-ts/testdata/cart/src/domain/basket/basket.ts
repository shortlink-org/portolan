import { BasketCheckedOut } from "./events/basket-checked-out.ts";
import { BasketItemAdded } from "./events/basket-item-added.ts";
import { Money } from "./vo/money.ts";
import { BasketItem } from "./item.ts";

/** A visitor's or a customer's lines, under one lock. */
export class Basket {
  readonly items: BasketItem[] = [];
  status: "open" | "checked-out" = "open";
  constructor(
    readonly id: string,
    readonly token: string,
    public currency: string | undefined,
    public version: number,
  ) {}

  static create(id: string, token: string): [Basket, BasketCheckedOut | undefined] {
    return [new Basket(id, token, undefined, 0), undefined];
  }

  addItem(sku: string, quantity: number, unitPrice: Money): BasketItemAdded {
    this.items.push(new BasketItem(sku, quantity, unitPrice));
    return new BasketItemAdded(this.id, sku, quantity, unitPrice);
  }

  checkout(total: Money, quoteId: string): BasketCheckedOut {
    this.status = "checked-out";
    return new BasketCheckedOut(this.id, total, quoteId);
  }
}
