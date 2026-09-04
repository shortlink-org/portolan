export type BasketErrorCode = "invalid" | "refused" | "not-open" | "not-found" | "not-yours" | "conflict";

/** What the basket refuses, and why, in a word a caller can switch on. */
export class BasketError extends Error {
  readonly code: BasketErrorCode;

  constructor(code: BasketErrorCode, message: string) {
    super(message);
    this.name = "BasketError";
    this.code = code;
  }
}
