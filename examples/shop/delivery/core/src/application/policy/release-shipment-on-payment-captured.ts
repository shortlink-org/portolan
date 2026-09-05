import { PaymentCaptured } from "../ledger/events.ts";
import type { UseCase as ReleaseShipment } from "../shipment/usecases/release_shipment/usecase.ts";

/**
 * Nothing leaves the warehouse before the money has moved (ADR core.0002).
 *
 * The rule hangs off the fact rather than off a call from the ledger: however
 * the money arrives - a card, a webhook, a correction - the same event says so,
 * and this behaviour comes with it. The policy calls a use case and decides
 * nothing itself; what "released" means is the shipment's rule.
 */
export class ReleaseShipmentOnPaymentCaptured {
  constructor(private readonly release: ReleaseShipment) {}

  async handle(event: unknown): Promise<void> {
    if (!(event instanceof PaymentCaptured)) return;

    await this.release.handle(event.orderId);
  }
}
