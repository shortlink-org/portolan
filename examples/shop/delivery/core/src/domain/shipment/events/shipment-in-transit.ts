/**
 * The first sighting after dispatch: the parcels are moving. Later scans add
 * to the history and say nothing, because "seen again" is not a change.
 */
export class ShipmentInTransit {
  readonly name = "delivery.ShipmentInTransit";
  readonly channel = "delivery.core.shipment";
  readonly shipmentId: string;
  readonly orderId: string;
  readonly location: string;
  readonly occurredAt: Date;

  constructor(shipmentId: string, orderId: string, location: string, occurredAt: Date) {
    this.shipmentId = shipmentId;
    this.orderId = orderId;
    this.location = location;
    this.occurredAt = occurredAt;
  }
}
