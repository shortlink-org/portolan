import type { MutationResolvers } from "./../../../types.generated.js";

/**
 * Cancel an order. Whether it is too late to is the order service's judgement
 * and its refusal travels back unchanged; this service does not know what
 * dispatch means.
 */
export const cancelOrder: NonNullable<MutationResolvers["cancelOrder"]> = async (_parent, arg, ctx) => {
  return ctx.orders.cancel(arg.input.id, arg.input.reason ?? null);
};
