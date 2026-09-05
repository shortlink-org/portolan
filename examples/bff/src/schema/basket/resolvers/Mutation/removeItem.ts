import type { MutationResolvers } from "./../../../types.generated.js";

export const removeItem: NonNullable<MutationResolvers["removeItem"]> = async (_parent, arg, ctx) => {
  return ctx.baskets.removeItem(ctx.bearer, arg.input.basketId, arg.input.sku);
};
