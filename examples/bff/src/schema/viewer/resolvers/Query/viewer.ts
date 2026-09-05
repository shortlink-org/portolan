import type { QueryResolvers } from "./../../../types.generated.js";

/**
 * Who the request belongs to. Auth is asked on every call rather than a token
 * being read here: this service holds no key and could not tell a forged one
 * from a live one.
 */
export const viewer: NonNullable<QueryResolvers["viewer"]> = async (_parent, _arg, ctx) => {
  const session = await ctx.sessions.current(ctx.bearer);
  if (!session) return null;

  return { userId: session.userId, expiresAt: session.expiresAt };
};
