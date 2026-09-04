import { Container } from "inversify";
import type { Pricing, Sessions } from "../application/basket/usecases/checkout/usecase.ts";
import { UseCase as Checkout } from "../application/basket/usecases/checkout/usecase.ts";
import { UseCase as Merge } from "../application/basket/usecases/merge/usecase.ts";
import { AuthSessions } from "../infrastructure/auth/client.ts";
import { PermissiveSessions } from "../infrastructure/auth/stand-in.ts";
import { PricingClient } from "../infrastructure/pricing/client.ts";
import { TOKENS } from "./tokens.ts";

export function buildContainer(settings: { authUrl?: string; pricingAddr?: string }): Container {
  const container = new Container();
  // The real adapter when the peer is named, a stand-in when it is not: two
  // bindings of one port, and the flow shows the one that goes somewhere.
  if (settings.authUrl) container.bind<Sessions>(TOKENS.Sessions).toConstantValue(new AuthSessions(settings.authUrl));
  else container.bind<Sessions>(TOKENS.Sessions).to(PermissiveSessions);
  container.bind<Pricing>(TOKENS.Pricing).to(PricingClient).inSingletonScope();
  container.bind(Checkout).toSelf();
  container.bind(Merge).toSelf();
  return container;
}
