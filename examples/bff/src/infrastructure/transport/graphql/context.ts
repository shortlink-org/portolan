// What every resolver is handed.
//
// The ports, and the bearer the request arrived with. A BFF has no aggregate
// and no store, so this is the whole of what a resolver may reach: name a
// port here and assembly decides what fills it, exactly as a use case's
// constructor does in a service that has use cases.
import type { Baskets } from "../../../ports/baskets.ts";
import type { OrderEvents } from "../../../ports/order-events.ts";
import type { Orders } from "../../../ports/orders.ts";
import type { Sessions } from "../../../ports/sessions.ts";
import type { Shipments } from "../../../ports/shipments.ts";

export interface GraphQLContext {
  sessions: Sessions;
  baskets: Baskets;
  orders: Orders;
  shipments: Shipments;
  orderEvents: OrderEvents;

  /** The bearer token the request carried, or "" when it carried none. */
  bearer: string;
}
