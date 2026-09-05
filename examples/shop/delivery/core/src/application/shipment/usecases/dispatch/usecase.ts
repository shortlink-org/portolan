import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";
import { TrackingCode } from "../../../../domain/shipment/vo/tracking-code.ts";

/** Whether an order still stands. A closed set: a status this service does not know is an error in the adapter, never a default here. */
export type OrderStanding = "live" | "cancelled";

/**
 * What dispatching needs of the order service, declared here by the only code
 * that calls it rather than in the domain: no line of the shipment domain asks
 * an order anything. The adapter over the generated client fills it at wiring
 * time.
 */
export interface Orders {
  standing(orderId: string): Promise<OrderStanding>;
}

/** Hands a planned shipment to the carrier and says so. */
export class UseCase {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly orders: Orders,
    private readonly now: () => Date,
  ) {}

  /**
   * The order is asked once more before the parcels leave: a cancelled order
   * whose parcels went out anyway is the expensive mistake this prevents. A
   * cancelled order's shipment is written off, and says so.
   */
  async handle(shipmentId: string, tracking: string): Promise<void> {
    const shipment = await this.shipments.byId(shipmentId);
    const standing = await this.orders.standing(shipment.orderId);

    if (standing === "cancelled") {
      const lost = shipment.lose("order-cancelled", this.now());
      await this.shipments.save(shipment, lost);
      return;
    }

    const dispatched = shipment.dispatch(new TrackingCode(tracking), this.now());
    await this.shipments.save(shipment, dispatched);
  }
}
