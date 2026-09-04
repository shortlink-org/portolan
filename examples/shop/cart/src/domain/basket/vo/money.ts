import { BasketError } from "../errors.ts";
import { Currency } from "./currency.ts";

/** An amount in the minor unit of the currency: an integer, never a float. */
export class Money {
  readonly amountMinor: number;
  readonly currency: Currency;

  constructor(amountMinor: number, currency: Currency) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new BasketError("invalid", `amount ${amountMinor} is not a whole number of minor units`);
    this.amountMinor = amountMinor;
    this.currency = currency;
  }

  static of(amountMinor: number, currency: string): Money {
    return new Money(amountMinor, new Currency(currency));
  }

  add(other: Money): Money {
    if (!this.currency.equals(other.currency)) throw new BasketError("refused", "cannot add amounts in two currencies");
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  times(n: number): Money {
    return new Money(this.amountMinor * n, this.currency);
  }
}
