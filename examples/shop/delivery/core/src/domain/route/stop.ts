import { Address } from "../shipment/vo/address.ts";
import { Window } from "./vo/window.ts";

/**
 * One place a van stops, and what it drops there.
 *
 * An entity: the stop is followed through the day - planned, then arrived at,
 * then done - which is what makes it more than a pair of values.
 */
export class Stop {
  readonly seq: number;
  readonly shipmentId: string;
  readonly address: Address;
  readonly window: Window;
  done = false;

  constructor(seq: number, shipmentId: string, address: Address, window: Window) {
    this.seq = seq;
    this.shipmentId = shipmentId;
    this.address = address;
    this.window = window;
  }

  complete(): void {
    this.done = true;
  }
}
