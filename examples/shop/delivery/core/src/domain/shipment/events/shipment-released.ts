/**
 * The money moved, and the shipment may now be planned onto a route and
 * dispatched. Said by this service, not by the ledger: the ledger says a
 * payment was captured, and what that means for a parcel is decided here.
 */
export class ShipmentReleased {
  readonly name = "delivery.ShipmentReleased";
  readonly channel = "delivery.core.shipment";
  readonly shipmentId: string;
  readonly orderId: string;
  readonly occurredAt: Date;

  constructor(shipmentId: string, orderId: string, occurredAt: Date) {
    this.shipmentId = shipmentId;
    this.orderId = orderId;
    this.occurredAt = occurredAt;
  }
}
