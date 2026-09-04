import type { Shipment } from "./shipment.ts";
import type { ShipmentDelivered } from "./events/shipment-delivered.ts";
import type { ShipmentDispatched } from "./events/shipment-dispatched.ts";

/** Events a change produced go to the store with it, or neither lands. */
export type ShipmentEvent = ShipmentDispatched | ShipmentDelivered;

/** Where shipments are kept. */
export interface ShipmentRepository {
  save(shipment: Shipment, ...events: ShipmentEvent[]): Promise<void>;
  byId(id: string): Promise<Shipment>;
  byTracking(tracking: string): Promise<Shipment>;
  byOrder(orderId: string): Promise<Shipment>;
}
