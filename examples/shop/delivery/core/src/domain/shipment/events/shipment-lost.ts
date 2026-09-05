/**
 * The shipment is written off, and nothing leads out of that. The reason is a
 * closed set, because whoever hears it unwinds differently: an order that
 * was cancelled expects this, one that was not needs a new shipment.
 */
export type LostReason = "order-cancelled" | "not-found";

export class ShipmentLost {
  readonly name = "delivery.ShipmentLost";
  readonly channel = "delivery.core.shipment";
  readonly shipmentId: string;
  readonly orderId: string;
  readonly reason: LostReason;
  readonly occurredAt: Date;

  constructor(shipmentId: string, orderId: string, reason: LostReason, occurredAt: Date) {
    this.shipmentId = shipmentId;
    this.orderId = orderId;
    this.reason = reason;
    this.occurredAt = occurredAt;
  }
}
