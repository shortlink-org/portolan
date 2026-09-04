/** The row shapes of a route, and the subject its events go out on. */
export const TOPIC = "delivery.core.route";

export interface RouteRow {
  id: string;
  vehicle: string;
  planned_for: Date;
  status: string;
}

export interface StopRow {
  route_id: string;
  seq: number;
  shipment_id: string;
  address: string;
  window_from: Date;
  window_to: Date;
  done: boolean;
}
