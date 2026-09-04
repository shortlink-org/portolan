// The order service over its gRPC API, through the client Connect generates
// from the vendored proto. Reads the answer back into the port's own shape.
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import type { Orders } from "../../application/shipment/usecases/dispatch/usecase.ts";
import { OrderService, OrderStatus } from "./gen/shop/v1/orders_pb.ts";

/** The enum the contract answers with, in the word the domain uses. */
const STATUS: Record<OrderStatus, string> = {
  [OrderStatus.UNSPECIFIED]: "unknown",
  [OrderStatus.PLACED]: "placed",
  [OrderStatus.CONFIRMED]: "confirmed",
  [OrderStatus.CANCELLED]: "cancelled",
};

/**
 * The adapter over the generated client. The contract it is generated from is
 * vendored beside this file, so the call is recorded under the id the order
 * service's own extractor gives it.
 */
export class OrderClient implements Orders {
  private readonly client: Client<typeof OrderService>;

  constructor(transport: Transport) {
    this.client = createClient(OrderService, transport);
  }

  /** What the order says about itself. An answer with no order is not one. */
  async getOrder(orderId: string): Promise<{ status: string }> {
    const answer = await this.client.getOrder({ orderId });
    const order = answer.order;
    if (!order) throw new Error(`order ${orderId}: the service answered with no order`);

    return { status: STATUS[order.status] ?? "unknown" };
  }
}
