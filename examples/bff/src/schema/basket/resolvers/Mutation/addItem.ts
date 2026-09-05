import type { MutationResolvers } from "./../../../types.generated.js";

/**
 * Add a line. The price travels as the customer was shown it; the cart
 * captures it and never recomputes it, and nothing here checks it - a
 * storefront that priced things would be a second place prices live.
 */
export const addItem: NonNullable<MutationResolvers["addItem"]> = async (_parent, arg, ctx) => {
  return ctx.baskets.addItem(ctx.bearer, arg.input.basketId, {
    sku: arg.input.sku,
    quantity: arg.input.quantity,
    unitPrice: arg.input.unitPrice,
  });
};
