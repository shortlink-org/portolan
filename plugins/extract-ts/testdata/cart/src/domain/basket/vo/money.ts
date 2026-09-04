/** An amount in the minor unit of a currency. */
export class Money {
  constructor(
    readonly amountMinor: number,
    readonly currency: string,
  ) {}
}
