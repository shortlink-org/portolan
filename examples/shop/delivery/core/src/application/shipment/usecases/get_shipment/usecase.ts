import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";
import type { Shipment } from "../../../../domain/shipment/shipment.ts";
import type { ShipmentStatus } from "../../../../domain/shipment/status.ts";

/**
 * One shipment, for whoever is asking about an order: which order, where it
 * is in its life, the code to follow it by, and how many boxes. Not the
 * address - the order has it, and a copy on this answer would be a second
 * place it lives.
 */
export interface ShipmentView {
  shipmentId: string;
  orderId: string;
  status: ShipmentStatus;
  tracking: string;
  parcels: number;
}

/** One shipment, for whoever is asking about an order. */
export class UseCase {
  constructor(private readonly shipments: ShipmentRepository) {}

  async handle(shipmentId: string): Promise<ShipmentView> {
    const shipment = await this.shipments.byId(shipmentId);

    return viewOf(shipment);
  }
}

function viewOf(shipment: Shipment): ShipmentView {
  return {
    shipmentId: shipment.id,
    orderId: shipment.orderId,
    status: shipment.status,
    tracking: shipment.tracking?.toString() ?? "",
    parcels: shipment.parcels.length,
  };
}
