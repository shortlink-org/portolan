// The order service over its gRPC API, through the client Connect generates
// from the vendored proto. Reads the answer back into the port's own words.
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import type { OrderStanding, Orders } from "../../application/shipment/usecases/dispatch/usecase.ts";
import { OrderService, OrderStatus } from "./gen/shop/v1/orders_pb.ts";

/**
 * The adapter over the generated client. The contract it is generated from is
 * vendored beside this file, so the call is recorded under the id the order
 * service's own extractor gives it. The contract's enum is read here and
 * nowhere else.
 */
export class OrderClient implements Orders {
  private readonly client: Client<typeof OrderService>;

  constructor(transport: Transport) {
    this.client = createClient(OrderService, transport);
  }

  /**
   * Whether the order still stands. A status this service does not know is an
   * error, not a default: the contract changed, and guessing which way is how
   * a cancelled order's parcels leave the warehouse.
   */
  async standing(orderId: string): Promise<OrderStanding> {
    const answer = await this.client.getOrder({ orderId });
    const order = answer.order;
    if (!order) throw new Error(`order ${orderId}: the service answered with no order`);

    switch (order.status) {
      case OrderStatus.PLACED:
      case OrderStatus.CONFIRMED:
        return "live";
      case OrderStatus.CANCELLED:
        return "cancelled";
      default:
        throw new Error(`order ${orderId}: status ${order.status} is not one this service knows`);
    }
  }
}
