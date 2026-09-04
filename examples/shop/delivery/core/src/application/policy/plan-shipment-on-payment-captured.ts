import type { ShipmentRepository } from "../../domain/shipment/port.ts";
import { PaymentCaptured } from "../../infrastructure/ledger/events.ts";

/**
 * Nothing leaves the warehouse before the money has moved.
 *
 * The rule hangs off the fact rather than off a call from the ledger: however
 * the money arrives - a card, a webhook, a correction - the same event says so,
 * and this behaviour comes with it.
 */
export class PlanShipmentOnPaymentCaptured {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly now: () => Date,
  ) {}

  async handle(event: unknown): Promise<void> {
    if (!(event instanceof PaymentCaptured)) return;

    const shipment = await this.shipments.byOrder(event.orderId);
    shipment.onRoute("");
    await this.shipments.save(shipment);
  }
}
