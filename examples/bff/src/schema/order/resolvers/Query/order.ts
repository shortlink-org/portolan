import type { QueryResolvers } from "./../../../types.generated.js";

export const order: NonNullable<QueryResolvers["order"]> = async (_parent, arg, ctx) => {
  return ctx.orders.byId(arg.id);
};
