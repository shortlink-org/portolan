import type { QueryResolvers } from "./../../../types.generated.js";

export const shipment: NonNullable<QueryResolvers["shipment"]> = async (_parent, arg, ctx) => {
  return ctx.shipments.byId(arg.id);
};
