import type { QueryResolvers } from "./../../../types.generated.js";

/** Who the request belongs to. */
export const viewer: NonNullable<QueryResolvers["viewer"]> = async (_parent, _arg, ctx) => {
  const session = await ctx.sessions.current(ctx.bearer);
  if (!session) return null;
  return { userId: session.userId };
};
