import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";
import { Shipment } from "../../../../domain/shipment/shipment.ts";

/**
 * Why the ledger would not capture. A closed set: an answer the adapter cannot
 * place is an error there, never a refusal here.
 */
export type CaptureRefusal = "no-payment" | "not-capturable";

/** What the ledger said to a capture: the money moved, or it would not move it. */
export type Capture = { outcome: "captured" } | { outcome: "refused"; reason: CaptureRefusal };

/**
 * What creating a shipment needs of the ledger, declared here by the only code
 * that calls it rather than in the domain: no line of the shipment domain
 * moves money. The adapter over the generated client fills it at wiring time.
 * An unreachable ledger is an error, not a refusal: it decided nothing.
 */
export interface Payments {
  capture(paymentId: string): Promise<Capture>;
}

/**
 * What happened to the money on this run. `not-asked` is a shipment that
 * already left the waiting room, released or written off, on a repeated
 * confirmation.
 */
export type PaymentAnswer = "captured" | CaptureRefusal | "not-asked";

export interface Result {
  shipmentId: string;
  payment: PaymentAnswer;
}

/** Turns a confirmed order into a shipment waiting for the money, and asks the ledger to move it. */
export class UseCase {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly payments: Payments,
    private readonly now: () => Date,
    private readonly newId: () => string,
  ) {}

  /**
   * The shipment is stored before the ledger is asked. The ledger announces
   * the capture while answering it, and the fact releases a shipment that has
   * to be there already; asked first, the release would find nothing.
   *
   * Once per order: a repeated confirmation finds the shipment it made and
   * does not make a second. It still asks for the capture while the shipment
   * waits, because the run that stored it may have died before the ledger
   * answered, and a second capture of the same payment moves nothing twice.
   * The payment is named by the order id (oms.0006).
   */
  async handle(orderId: string): Promise<Result> {
    let shipment = await this.shipments.findByOrder(orderId);
    if (!shipment) {
      const [created, event] = Shipment.create(this.newId(), orderId, this.now());
      await this.shipments.save(created, event);
      shipment = created;
    }

    if (shipment.status !== "awaiting-payment") {
      return { shipmentId: shipment.id, payment: "not-asked" };
    }

    const capture = await this.payments.capture(orderId);
    if (capture.outcome === "refused") {
      return { shipmentId: shipment.id, payment: capture.reason };
    }

    return { shipmentId: shipment.id, payment: "captured" };
  }
}
