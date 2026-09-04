/**
 * It arrived, and who signed. The order is finished from this service's side;
 * whether the money is settled is somebody else's question.
 */
export class ShipmentDelivered {
  readonly name = "delivery.ShipmentDelivered";
  readonly channel = "delivery.core.shipment";
  readonly shipmentId: string;
  readonly orderId: string;
  readonly signedBy: string;
  readonly occurredAt: Date;

  constructor(shipmentId: string, orderId: string, signedBy: string, occurredAt: Date) {
    this.shipmentId = shipmentId;
    this.orderId = orderId;
    this.signedBy = signedBy;
    this.occurredAt = occurredAt;
  }
}
