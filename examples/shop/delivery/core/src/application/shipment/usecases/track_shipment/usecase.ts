import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";
import type { Shipment } from "../../../../domain/shipment/shipment.ts";
import type { ShipmentStatus } from "../../../../domain/shipment/status.ts";

/**
 * What the customer sees when they paste a tracking code: where the parcels
 * are and where they have been. Not the address, not the order, not the
 * route - a tracking code is something a customer forwards, and the page it
 * opens says nothing that the code alone should not.
 */
export interface TrackingView {
  shipmentId: string;
  status: ShipmentStatus;
  tracking: string;
  scans: { parcelId: string; location: string; scannedAt: string }[];
}

/** What the customer sees when they paste a tracking code. */
export class UseCase {
  constructor(private readonly shipments: ShipmentRepository) {}

  async handle(tracking: string): Promise<TrackingView> {
    const shipment = await this.shipments.byTracking(tracking);

    return viewOf(shipment);
  }
}

function viewOf(shipment: Shipment): TrackingView {
  return {
    shipmentId: shipment.id,
    status: shipment.status,
    tracking: shipment.tracking?.toString() ?? "",
    scans: shipment.scans.map((scan) => ({
      parcelId: scan.parcelId,
      location: scan.location,
      scannedAt: scan.scannedAt.toISOString(),
    })),
  };
}
