import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";

/** Ends a shipment at the door. */
export class UseCase {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly now: () => Date,
  ) {}

  async handle(shipmentId: string, signedBy: string): Promise<void> {
    const shipment = await this.shipments.byId(shipmentId);
    const delivered = shipment.deliver(signedBy, this.now());
    await this.shipments.save(shipment, delivered);
  }
}
