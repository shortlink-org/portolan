import type { MutationResolvers } from "./../../../types.generated.js";

/** A field whose resolver reaches nothing: there is one step to draw and it is the ask. */
export const addItem: NonNullable<MutationResolvers["addItem"]> = async (_parent, arg, _ctx) => {
  return { id: arg.input.basketId };
};
