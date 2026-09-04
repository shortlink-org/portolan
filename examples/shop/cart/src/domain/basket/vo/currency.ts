import { BasketError } from "../errors.ts";

/** ISO 4217, upper case. A basket has one, set by its first line. */
export class Currency {
  readonly code: string;

  constructor(code: string) {
    if (!/^[A-Z]{3}$/.test(code)) throw new BasketError("invalid", `currency ${JSON.stringify(code)} is not an ISO 4217 code`);
    this.code = code;
  }

  equals(other: Currency): boolean {
    return this.code === other.code;
  }
}
