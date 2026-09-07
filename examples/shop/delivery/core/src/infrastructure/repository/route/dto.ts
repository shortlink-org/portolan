/**
 * The row shapes of a route, the day as the row holds it, and the wire form
 * of its events: what goes into the outbox row's payload, under the subject
 * the events go out on.
 */
import type { RouteEvent } from "../../../domain/route/port.ts";
import type { StoredAddress } from "../shipment/dto.ts";

export const TOPIC = "delivery.core.route";

export interface RouteRow {
  id: string;
  vehicle: string;
  /** Read as text: a `date` has no clock and no zone, and a Date has both. */
  planned_for: string;
  status: string;
}

export interface StopRow {
  route_id: string;
  seq: number;
  shipment_id: string;
  address: StoredAddress;
  window_from: Date;
  window_to: Date;
  done: boolean;
}

/** The calendar day of a moment, as the `date` column takes it. */
export function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The moment a stored day begins, as the aggregate takes it back. */
export function startOf(stored: string): Date {
  return new Date(`${stored}T00:00:00Z`);
}

export function toWire(event: RouteEvent): Record<string, unknown> {
  switch (event.name) {
    case "delivery.RoutePlanned":
      return { routeId: event.routeId, vehicle: event.vehicle, stops: event.stops, occurredAt: event.occurredAt };
    case "delivery.RouteStarted":
      return { routeId: event.routeId, vehicle: event.vehicle, occurredAt: event.occurredAt };
    case "delivery.RouteClosed":
      return { routeId: event.routeId, vehicle: event.vehicle, undone: event.undone, occurredAt: event.occurredAt };
  }
}
