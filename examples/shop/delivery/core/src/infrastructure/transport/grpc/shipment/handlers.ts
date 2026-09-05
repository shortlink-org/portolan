import type { UseCase as Dispatch } from "../../../../application/shipment/usecases/dispatch/usecase.ts";
import type { UseCase as GetShipment } from "../../../../application/shipment/usecases/get_shipment/usecase.ts";
import type { UseCase as RecordDelivery } from "../../../../application/shipment/usecases/record_delivery/usecase.ts";
import type { UseCase as RecordScan } from "../../../../application/shipment/usecases/record_scan/usecase.ts";
import type { UseCase as TrackShipment } from "../../../../application/shipment/usecases/track_shipment/usecase.ts";

/**
 * The way in for shipments: one method per rpc of delivery.v1.Delivery, each
 * running one use case and translating what it answers.
 */
export class ShipmentHandlers {
  constructor(
    private readonly dispatching: Dispatch,
    private readonly scanning: RecordScan,
    private readonly delivering: RecordDelivery,
    private readonly tracking: TrackShipment,
    private readonly lookup: GetShipment,
  ) {}

  /** Hands a planned shipment to the carrier. */
  async dispatch(shipmentId: string, trackingCode: string): Promise<unknown> {
    await this.dispatching.handle(shipmentId, trackingCode);
    const shipment = await this.lookup.handle(shipmentId);

    return { shipmentId, status: shipment.status };
  }

  /** Writes down that a parcel was seen somewhere. */
  async recordScan(shipmentId: string, parcelId: string, location: string): Promise<unknown> {
    await this.scanning.handle(shipmentId, parcelId, location);

    return { shipmentId };
  }

  /** Ends a shipment at the door. */
  async recordDelivery(shipmentId: string, signedBy: string): Promise<unknown> {
    await this.delivering.handle(shipmentId, signedBy);

    return { shipmentId };
  }

  /** What the customer sees when they paste a tracking code. */
  async trackShipment(code: string): Promise<unknown> {
    return this.tracking.handle(code);
  }

  /** One shipment, for whoever is asking about an order. */
  async getShipment(shipmentId: string): Promise<unknown> {
    return this.lookup.handle(shipmentId);
  }
}
