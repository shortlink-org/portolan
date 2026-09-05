import type { MutationResolvers } from "./../../../types.generated.js";

/**
 * Freeze the basket and hand it on.
 *
 * No order is placed here. The cart publishes that the basket was checked
 * out; the order service hears it and places one. What comes back is the
 * quote the customer agreed to, which is what a confirmation page shows while
 * the order is on its way into being.
 */
export const checkout: NonNullable<MutationResolvers["checkout"]> = async (_parent, arg, ctx) => {
  return ctx.baskets.checkout(ctx.bearer, arg.input.basketId);
};
