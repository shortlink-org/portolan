// The ledger over its gRPC API, through the client Connect generates from the
// vendored proto. Reads the answer back into the port's own words.
import { Code, ConnectError, createClient, type Client, type Transport } from "@connectrpc/connect";
import type { Capture, Payments } from "../../application/shipment/usecases/create_shipment/usecase.ts";
import { PaymentService } from "./gen/payments/v1/payments_pb.ts";

/**
 * The adapter over the generated client. The contract it is generated from is
 * vendored beside this file, so the call is recorded under the id the ledger's
 * own extractor gives it. The ledger's status codes are read here and nowhere
 * else.
 */
export class LedgerClient implements Payments {
  private readonly client: Client<typeof PaymentService>;

  constructor(transport: Transport) {
    this.client = createClient(PaymentService, transport);
  }

  /**
   * Moves what the gateway was holding for the payment. The two refusals the
   * ledger names are answers: it has never seen the payment, or the payment is
   * not one that can be captured. Every other code - the gateway silent, the
   * ledger's store failing, a concurrent attempt - decided nothing, and is an
   * error for the caller to try again.
   */
  async capture(paymentId: string): Promise<Capture> {
    try {
      const answer = await this.client.capture({ paymentId }, { timeoutMs: 10_000 });
      if (answer.paymentId !== paymentId) {
        throw new Error(`payment ${paymentId}: the ledger answered for a different payment`);
      }
      return { outcome: "captured" };
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) return refusal;
      throw err;
    }
  }
}

function refusalOf(err: unknown): Capture | undefined {
  if (!(err instanceof ConnectError)) return undefined;
  switch (err.code) {
    case Code.NotFound:
      return { outcome: "refused", reason: "no-payment" };
    case Code.FailedPrecondition:
      return { outcome: "refused", reason: "not-capturable" };
    default:
      return undefined;
  }
}
