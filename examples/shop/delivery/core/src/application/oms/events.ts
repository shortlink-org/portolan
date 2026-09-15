/**
 * The order service's facts, as this service needs to react to them: a
 * narrowed copy with only the fields delivery reads, declared here beside the
 * policy that listens rather than in infrastructure, so the policy imports
 * nothing that knows about a wire. Whatever reads the bus translates into
 * this. The manifest says which aggregate it belongs to.
 *
 * The authorization id the order service puts on the wire is left out: the
 * payment is named by the order id (oms.0006), and that is all delivery asks
 * the ledger with.
 */
export class OrderConfirmed {
  readonly name = "oms.OrderConfirmed";
  readonly orderId: string;

  constructor(orderId: string) {
    this.orderId = orderId;
  }
}
