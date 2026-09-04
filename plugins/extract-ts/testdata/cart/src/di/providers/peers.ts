import type { Pricing, Sessions } from "../../application/basket/usecases/checkout/usecase.ts";
import { AuthSessions } from "../../infrastructure/auth/client.ts";
import { PricingClient } from "../../infrastructure/pricing/client.ts";

export function provideSessions(authUrl: string): Sessions {
  return new AuthSessions(authUrl);
}

export function providePricing(transport: unknown): Pricing {
  return new PricingClient(transport);
}
