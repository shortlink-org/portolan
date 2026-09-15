/**
 * A confirmed order became something to carry. Nothing is packed yet and the
 * shipment has nowhere to go: it waits for the money, and the ledger has just
 * been asked to move it (ADR core.0003).
 */
export class ShipmentCreated {
  readonly name = "delivery.ShipmentCreated";
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
