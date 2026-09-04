import { Parcel } from "./parcel.ts";
import { Scan } from "./scan.ts";
import { ShipmentDelivered } from "./events/shipment-delivered.ts";
import { ShipmentDispatched } from "./events/shipment-dispatched.ts";
import { canMove, type ShipmentStatus } from "./status.ts";
import { Address } from "./vo/address.ts";
import { TrackingCode } from "./vo/tracking-code.ts";

/**
 * What is being carried to one address for one order.
 *
 * The address is copied from the order at dispatch and never refreshed: a
 * parcel on a van does not move because somebody edited their profile. The
 * status only ever moves the way `TRANSITIONS` allows, and `moveTo` is the one
 * way through it.
 */
export class Shipment {
  readonly id: string;
  readonly orderId: string;
  readonly shipTo: Address;
  readonly parcels: Parcel[];
  readonly scans: Scan[] = [];
  status: ShipmentStatus = "planned";
  tracking: TrackingCode | undefined;
  routeId: string | undefined;

  constructor(id: string, orderId: string, shipTo: Address, parcels: Parcel[]) {
    if (parcels.length === 0) throw new Error("a shipment carries at least one parcel");
    this.id = id;
    this.orderId = orderId;
    this.shipTo = shipTo;
    this.parcels = parcels;
  }

  /** The one way the status changes; a move the table does not allow is refused. */
  private moveTo(next: ShipmentStatus): void {
    if (!canMove(this.status, next)) {
      throw new Error(`a ${this.status} shipment does not become ${next}`);
    }
    this.status = next;
  }

  /** Hands the parcels to the carrier and starts the tracking. */
  dispatch(tracking: TrackingCode, at: Date): ShipmentDispatched {
    this.tracking = tracking;
    this.moveTo("dispatched");

    return new ShipmentDispatched(this.id, this.orderId, tracking, this.parcels.length, at);
  }

  /**
   * Records a sighting. The first one moves the shipment along; the rest only
   * add to the history, because "seen again" is not a change of state.
   */
  record(scan: Scan): void {
    this.scans.push(scan);
    if (this.status === "dispatched") {
      this.moveTo("in-transit");
    }
  }

  /** Ends the shipment at the door. */
  deliver(signedBy: string, at: Date): ShipmentDelivered {
    this.moveTo("delivered");

    return new ShipmentDelivered(this.id, this.orderId, signedBy, at);
  }

  /** Writes the shipment off. Nothing leads out of this. */
  lose(): void {
    this.moveTo("lost");
  }

  onRoute(routeId: string): void {
    this.routeId = routeId;
  }
}
