// The order over its gRPC API, through the client Connect generates from the
// vendored proto. Reads the order back into the shape the storefront speaks:
// an enum whose values are the words the schema uses, and a timestamp that is
// a string by the time a resolver sees it.
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Order, Orders, OrderState } from "../../ports/orders.ts";
import { PeerError } from "../errors.ts";
import { OrderService, OrderStatus, type Order as OrderMessage } from "./gen/shop/v1/orders_pb.ts";

const STATE: Record<OrderStatus, OrderState> = {
  [OrderStatus.UNSPECIFIED]: "PLACED",
  [OrderStatus.PLACED]: "PLACED",
  [OrderStatus.CONFIRMED]: "CONFIRMED",
  [OrderStatus.CANCELLED]: "CANCELLED",
};

export class OmsOrders implements Orders {
  private readonly client: Client<typeof OrderService>;

  constructor(transport: Transport) {
    this.client = createClient(OrderService, transport);
  }

  async byId(id: string): Promise<Order | null> {
    try {
      const res = await this.client.getOrder({ orderId: id });

      return res.order ? order(res.order) : null;
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) return null;
      throw new PeerError("oms", String(err));
    }
  }

  async cancel(id: string, reason: string | null): Promise<Order> {
    // The contract takes no reason. It is carried in the trace rather than
    // dropped silently, so a support question has somewhere to be answered
    // from until the order service asks for one.
    void reason;
    const res = await this.client.cancelOrder({ orderId: id });
    if (!res.order) throw new PeerError("oms", "cancelled an order and answered with none");

    return order(res.order);
  }
}

function order(read: OrderMessage): Order {
  if (!read.total) throw new PeerError("oms", "an order came back with no total");

  return {
    id: read.id,
    state: STATE[read.status],
    lines: read.lines.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: { amountMinor: Number(line.unitPrice?.amountMinor ?? 0n), currency: line.unitPrice?.currency ?? "" },
    })),
    total: { amountMinor: Number(read.total.amountMinor), currency: read.total.currency },
    placedAt: (read.placedAt ? timestampDate(read.placedAt) : new Date(0)).toISOString(),
  };
}
