import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";
import { TrackingCode } from "../../../../domain/shipment/vo/tracking-code.ts";

/**
 * What dispatching needs of the order service, declared here by the only code
 * that calls it rather than in the domain: no line of the shipment domain asks
 * an order anything. The adapter over the generated client fills it at wiring
 * time.
 */
export interface Orders {
  getOrder(orderId: string): Promise<{ status: string }>;
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
   * whose parcels went out anyway is the expensive mistake this prevents.
   */
  async handle(shipmentId: string, tracking: string): Promise<void> {
    const shipment = await this.shipments.byId(shipmentId);
    const order = await this.orders.getOrder(shipment.orderId);

    if (order.status === "cancelled") {
      shipment.lose();
      await this.shipments.save(shipment);
      return;
    }

    const dispatched = shipment.dispatch(new TrackingCode(tracking), this.now());
    await this.shipments.save(shipment, dispatched);
  }
}
