/**
 * The shape of the ledger's events, as this service reads them.
 *
 * A narrowed copy: only the fields delivery uses. The manifest says which
 * aggregate they belong to; without that line the policy names a type and the
 * step resolves to nothing.
 */
export class PaymentCaptured {
  readonly name = "ledger.PaymentCaptured";
  readonly paymentId: string;
  readonly orderId: string;

  constructor(paymentId: string, orderId: string) {
    this.paymentId = paymentId;
    this.orderId = orderId;
  }
}
