/**
 * The row shapes of a shipment, the address as the row holds it, and the
 * wire form of its events: what goes into the outbox row's payload, under
 * the subject the events go out on.
 */
import type { ShipmentEvent } from "../../../domain/shipment/port.ts";
import { Address } from "../../../domain/shipment/vo/address.ts";

export const TOPIC = "delivery.core.shipment";

export interface PackageRow {
  id: string;
  order_id: string;
  ship_to: StoredAddress;
  status: string;
  tracking: string | null;
  route_id: string | null;
  dispatched_at: Date | null;
}

export interface ParcelRow {
  id: string;
  package_id: string;
  weight_g: number;
  contents: string;
}

export interface ScanRow {
  parcel_id: string;
  location: string;
  scanned_at: Date;
}

/**
 * An address in a jsonb column: five lines read back whole and never queried
 * by part, which is a document rather than five columns. The same shape sits
 * in the stop's copy of it.
 */
export interface StoredAddress {
  line1: string;
  line2: string;
  city: string;
  postcode: string;
  country: string;
}

export function storeAddress(address: Address): string {
  const stored: StoredAddress = { line1: address.line1, line2: address.line2, city: address.city, postcode: address.postcode, country: address.country };
  return JSON.stringify(stored);
}

export function readAddress(stored: StoredAddress): Address {
  return new Address(stored.line1, stored.line2, stored.city, stored.postcode, stored.country);
}

export function toWire(event: ShipmentEvent): Record<string, unknown> {
  switch (event.name) {
    case "delivery.ShipmentReleased":
      return { shipmentId: event.shipmentId, orderId: event.orderId, occurredAt: event.occurredAt };
    case "delivery.ShipmentDispatched":
      return { shipmentId: event.shipmentId, orderId: event.orderId, tracking: event.tracking.value, parcels: event.parcels, occurredAt: event.occurredAt };
    case "delivery.ShipmentInTransit":
      return { shipmentId: event.shipmentId, orderId: event.orderId, location: event.location, occurredAt: event.occurredAt };
    case "delivery.ShipmentDelivered":
      return { shipmentId: event.shipmentId, orderId: event.orderId, signedBy: event.signedBy, occurredAt: event.occurredAt };
    case "delivery.ShipmentLost":
      return { shipmentId: event.shipmentId, orderId: event.orderId, reason: event.reason, occurredAt: event.occurredAt };
  }
}
