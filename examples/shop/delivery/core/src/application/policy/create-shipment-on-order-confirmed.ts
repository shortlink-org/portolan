import { OrderConfirmed } from "../oms/events.ts";
import type { UseCase as CreateShipment } from "../shipment/usecases/create_shipment/usecase.ts";

/**
 * A confirmed order becomes something to carry, and the money for it is asked
 * to move (ADR core.0003).
 *
 * The policy hangs off the order service's fact, not off a call from it: the
 * order service says what happened to the order and does not know that a
 * warehouse is listening. It decides nothing itself; whether a shipment
 * exists already, and whether the ledger is asked, is the use case's rule.
 * An error goes back to whatever delivered the fact, so an unreachable ledger
 * is tried again on redelivery rather than forgotten.
 */
export class CreateShipmentOnOrderConfirmed {
  constructor(private readonly create: CreateShipment) {}

  async handle(event: unknown): Promise<void> {
    if (!(event instanceof OrderConfirmed)) return;

    await this.create.handle(event.orderId);
  }
}
