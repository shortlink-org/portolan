// The assembly. Every port the resolvers declare is filled here, and this is
// the one place in the tree that knows both sides exist. Read top to bottom it
// is the wiring diagram; the catalog reads it the same way.
//
// There are no use cases to bind: a BFF composes what other services decided
// and decides nothing itself (ADR bff.0002), so what a resolver holds is an
// adapter over a peer, and assembly is the file that says which peer.
import { createGrpcTransport } from "@connectrpc/connect-node";
import { AuthSessions } from "../infrastructure/auth/client.ts";
import { JetStreamOrderEvents, NoOrderEvents } from "../infrastructure/bus/jetstream.ts";
import { CartBaskets } from "../infrastructure/cart/client.ts";
import { DeliveryShipments } from "../infrastructure/delivery/client.ts";
import { OmsOrders } from "../infrastructure/oms/client.ts";
import type { GraphQLContext } from "../infrastructure/transport/graphql/context.ts";
import type { Baskets } from "../ports/baskets.ts";
import type { OrderEvents } from "../ports/order-events.ts";
import type { Orders } from "../ports/orders.ts";
import type { Sessions } from "../ports/sessions.ts";
import type { Shipments } from "../ports/shipments.ts";

export interface Settings {
  /** Where auth answers. */
  authUrl: string;
  /** Where the cart answers. */
  cartUrl: string;
  /** Where the order service answers. */
  omsAddr: string;
  /** Where delivery answers. */
  deliveryAddr: string;
  /** Where NATS is; unset, a subscription is answered and nothing ever arrives on it. */
  natsUrl?: string | undefined;
}

export function provideSessions(settings: Settings): Sessions {
  return new AuthSessions(settings.authUrl);
}

export function provideBaskets(settings: Settings): Baskets {
  return new CartBaskets(settings.cartUrl);
}

export function provideOrders(settings: Settings): Orders {
  return new OmsOrders(createGrpcTransport({ baseUrl: settings.omsAddr }));
}

export function provideShipments(settings: Settings): Shipments {
  return new DeliveryShipments(createGrpcTransport({ baseUrl: settings.deliveryAddr }));
}

export function provideOrderEvents(settings: Settings): OrderEvents {
  if (!settings.natsUrl) return new NoOrderEvents();

  return new JetStreamOrderEvents(settings.natsUrl);
}

/**
 * The ports, made once. What changes per request is the bearer the request
 * arrived with, and the transport adds that as it builds each context.
 */
export type Ports = Omit<GraphQLContext, "bearer">;

export function buildPorts(settings: Settings): Ports {
  return {
    sessions: provideSessions(settings),
    baskets: provideBaskets(settings),
    orders: provideOrders(settings),
    shipments: provideShipments(settings),
    orderEvents: provideOrderEvents(settings),
  };
}
