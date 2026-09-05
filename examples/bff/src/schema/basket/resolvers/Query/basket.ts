import type { QueryResolvers } from "./../../../types.generated.js";

/** The basket as the cart has it, in the storefront's words. */
export const basket: NonNullable<QueryResolvers["basket"]> = async (_parent, arg, ctx) => {
  return ctx.baskets.byId(ctx.bearer, arg.id);
};
