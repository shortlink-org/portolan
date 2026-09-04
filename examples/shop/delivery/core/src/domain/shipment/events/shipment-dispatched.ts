import { TrackingCode } from "../vo/tracking-code.ts";

/**
 * The parcels are with the carrier. Whoever is waiting on the order hears this
 * and stops asking; the tracking code is on the event because the customer is
 * shown it and nobody should have to come back for it.
 */
export class ShipmentDispatched {
  readonly name = "delivery.ShipmentDispatched";
  readonly channel = "delivery.core.shipment";
  readonly shipmentId: string;
  readonly orderId: string;
  readonly tracking: TrackingCode;
  readonly parcels: number;
  readonly occurredAt: Date;

  constructor(shipmentId: string, orderId: string, tracking: TrackingCode, parcels: number, occurredAt: Date) {
    this.shipmentId = shipmentId;
    this.orderId = orderId;
    this.tracking = tracking;
    this.parcels = parcels;
    this.occurredAt = occurredAt;
  }
}
