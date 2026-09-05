// What the storefront needs from whoever is carrying the parcel.
export interface Shipment {
  id: string;
  orderId: string;
  /** Delivery's own word for where the parcel is; passed on unchanged. */
  state: string;
  trackingCode: string | null;
  parcels: number;
}

export interface Shipments {
  /** The shipment, or null when nothing has been handed to a carrier yet. */
  byId(id: string): Promise<Shipment | null>;
}
