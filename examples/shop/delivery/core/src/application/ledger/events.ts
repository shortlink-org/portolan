/**
 * The shape of the ledger's facts, as this service needs to react to them: a
 * narrowed copy with only the fields delivery reads, declared here beside the
 * policy that listens rather than in infrastructure, so the policy imports
 * nothing that knows about a wire. Whatever reads the bus translates into
 * this. The manifest says which aggregate it belongs to; without that line
 * the policy names a type and the step resolves to nothing.
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
