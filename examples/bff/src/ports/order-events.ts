// What the storefront needs to keep answering a subscription.
//
// The moves of an order are on the bus already; this is the port that hands
// them over, one order at a time, until the client stops listening.
import type { OrderState } from "./orders.ts";

export interface OrderMoved {
  orderId: string;
  state: OrderState;
  at: string;
}

export interface OrderEvents {
  /** Every move of this order, until the signal says the listener has gone. */
  moves(orderId: string, signal: AbortSignal): AsyncIterable<OrderMoved>;
}
