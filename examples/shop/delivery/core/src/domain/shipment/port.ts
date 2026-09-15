import type { Shipment } from "./shipment.ts";
import type { ShipmentCreated } from "./events/shipment-created.ts";
import type { ShipmentDelivered } from "./events/shipment-delivered.ts";
import type { ShipmentDispatched } from "./events/shipment-dispatched.ts";
import type { ShipmentInTransit } from "./events/shipment-in-transit.ts";
import type { ShipmentLost } from "./events/shipment-lost.ts";
import type { ShipmentReleased } from "./events/shipment-released.ts";

/** Events a change produced go to the store with it, or neither lands. */
export type ShipmentEvent = ShipmentCreated | ShipmentReleased | ShipmentDispatched | ShipmentInTransit | ShipmentDelivered | ShipmentLost;

/** Where shipments are kept. */
export interface ShipmentRepository {
  save(shipment: Shipment, ...events: ShipmentEvent[]): Promise<void>;
  byId(id: string): Promise<Shipment>;
  byTracking(tracking: string): Promise<Shipment>;
  byOrder(orderId: string): Promise<Shipment>;
  /** The order's shipment, or nothing when there is none yet: not having one is an answer here, not a refusal. */
  findByOrder(orderId: string): Promise<Shipment | undefined>;
}
