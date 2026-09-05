import type { SubscriptionResolvers } from "./../../../types.generated.js";

/**
 * Every move of one order, for as long as somebody is watching it.
 *
 * The moves are on the bus already - the order service publishes them for the
 * ledger and for delivery - and this forwards the ones about this order. The
 * signal is the client going away, and it is what stops the consumer.
 */
export const orderStatus: NonNullable<SubscriptionResolvers["orderStatus"]> = {
  subscribe: async function* (_parent, arg, ctx) {
    const stopped = new AbortController();

    try {
      for await (const moved of ctx.orderEvents.moves(arg.id, stopped.signal)) {
        yield { orderStatus: moved };
      }
    } finally {
      stopped.abort();
    }
  },
};
