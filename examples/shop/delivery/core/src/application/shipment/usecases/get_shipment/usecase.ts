import type { Shipment } from "../../../../domain/shipment/shipment.ts";
import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";

/** One shipment, for whoever is asking about an order. */
export class UseCase {
  constructor(private readonly shipments: ShipmentRepository) {}

  async handle(shipmentId: string): Promise<Shipment> {
    return this.shipments.byId(shipmentId);
  }
}
