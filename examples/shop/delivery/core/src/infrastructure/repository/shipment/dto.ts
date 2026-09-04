/**
 * The row shapes of a shipment, and the subject its events go out on.
 */
export const TOPIC = "delivery.core.shipment";

export interface PackageRow {
  id: string;
  order_id: string;
  ship_to: string;
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
