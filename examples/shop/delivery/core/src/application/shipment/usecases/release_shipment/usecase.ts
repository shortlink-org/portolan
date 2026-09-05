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

  async handle(orderId: string): Promise<void> {
    const shipment = await this.shipments.byOrder(orderId);
    const released = shipment.release(this.now());
    await this.shipments.save(shipment, released);
  }
}
