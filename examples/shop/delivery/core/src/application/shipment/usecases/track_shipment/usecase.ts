import type { Shipment } from "../../../../domain/shipment/shipment.ts";
import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";

/** What the customer sees when they paste a tracking code. */
export class UseCase {
  constructor(private readonly shipments: ShipmentRepository) {}

  async handle(tracking: string): Promise<Shipment> {
    return this.shipments.byTracking(tracking);
  }
}
