// The shipment's lifecycle, as one table. Every way a shipment can move is a
// row here and nowhere else, so a transition nobody wrote down cannot happen
// quietly. Nothing leads out of `delivered` or `lost`: both are the end, and a
// parcel that turns up after being written off is a new shipment.

export type ShipmentStatus = "planned" | "dispatched" | "in-transit" | "delivered" | "lost";

/** Where a shipment can go from where it is. */
export const TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  planned: ["dispatched", "lost"],
  dispatched: ["in-transit", "delivered", "lost"],
  "in-transit": ["delivered", "lost"],
  delivered: [],
  lost: [],
};

export function canMove(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
