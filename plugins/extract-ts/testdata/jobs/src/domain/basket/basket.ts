import { BasketAbandoned } from "./events/basket-abandoned.ts";

export class Basket {
  constructor(readonly id: string) {}

  abandon(): BasketAbandoned {
    return new BasketAbandoned(this.id);
  }
}
