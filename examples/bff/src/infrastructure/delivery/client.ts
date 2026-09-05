// The parcel over delivery's gRPC API.
//
// Delivery answers with its own word for where a parcel is, and the schema
// passes it on as a string. Turning it into an enum here would mean deciding,
// in a service that decides nothing, what the words are.
import { Code, ConnectError, createClient, type Client, type Transport } from "@connectrpc/connect";
import type { Shipment, Shipments } from "../../ports/shipments.ts";
import { PeerError } from "../errors.ts";
import { Delivery } from "./gen/delivery/v1/delivery_pb.ts";

export class DeliveryShipments implements Shipments {
  private readonly client: Client<typeof Delivery>;

  constructor(transport: Transport) {
    this.client = createClient(Delivery, transport);
  }

  async byId(id: string): Promise<Shipment | null> {
    try {
      const res = await this.client.getShipment({ shipmentId: id });

      return {
        id: res.shipmentId,
        orderId: res.orderId,
        state: res.status,
        trackingCode: res.tracking || null,
        parcels: res.parcels,
      };
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) return null;
      throw new PeerError("delivery", String(err));
    }
  }
}
