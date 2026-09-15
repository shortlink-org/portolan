import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";

/**
 * Lets a shipment out of the warehouse's waiting room once the money for its
 * order has moved. Called by the policy that hears the ledger; nobody calls it
 * from outside, because nothing outside gets to say the money moved.
 */
export class UseCase {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly now: () => Date,
  ) {}

  /**
   * A shipment already out of the waiting room answers nothing. `PaymentCaptured`
   * arrives at least once, and the ledger says it again for a repeated capture
   * (ledger.0004); the first one was acted on, and a refusal here would only
   * have the bus deliver the same fact again, and again.
   */
  async handle(orderId: string): Promise<void> {
    const shipment = await this.shipments.byOrder(orderId);
    if (shipment.status !== "awaiting-payment") return;
    const released = shipment.release(this.now());
    await this.shipments.save(shipment, released);
  }
}
