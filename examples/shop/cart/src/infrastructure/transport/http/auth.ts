// Who is asking: the basket's token, or the customer's bearer. Read here and
// handed to the use cases as strings; what they mean is the use cases' to
// decide (cart.0007).
import type { FastifyRequest } from "fastify";
import { BasketError } from "../../../domain/basket/errors.ts";

export const BASKET_TOKEN_HEADER = "x-basket-token";

export function basketToken(req: FastifyRequest): string {
  const token = req.headers[BASKET_TOKEN_HEADER];
  if (typeof token !== "string" || token === "") throw new BasketError("not-found", "no such basket");
  return token;
}

export function bearer(req: FastifyRequest): string {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) throw new BasketError("not-yours", "no live session");
  return token;
}
