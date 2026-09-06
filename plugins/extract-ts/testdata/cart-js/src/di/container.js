import { Container } from "inversify";
import { UseCase as Checkout } from "../application/basket/usecases/checkout/usecase.js";
import { UseCase as Merge } from "../application/basket/usecases/merge/usecase.js";
import { AuthSessions } from "../infrastructure/auth/client.js";
import { PermissiveSessions } from "../infrastructure/auth/stand-in.js";
import { PricingClient } from "../infrastructure/pricing/client.js";
import { TOKENS } from "./tokens.js";

/** @typedef {import("../application/basket/usecases/checkout/usecase.js").Pricing} Pricing */
/** @typedef {import("../application/basket/usecases/checkout/usecase.js").Sessions} Sessions */

/**
 * @param {{ authUrl?: string; pricingAddr?: string }} settings
 * @returns {Container}
 */
export function buildContainer(settings) {
  const container = new Container();
  // The real adapter when the peer is named, a stand-in when it is not: two
  // bindings of one port, and the flow shows the one that goes somewhere.
  // Without a type argument the token names the port.
  if (settings.authUrl) container.bind(TOKENS.Sessions).toConstantValue(new AuthSessions(settings.authUrl));
  else container.bind(TOKENS.Sessions).to(PermissiveSessions);
  container.bind(TOKENS.Pricing).to(PricingClient).inSingletonScope();
  container.bind(Checkout).toSelf();
  container.bind(Merge).toSelf();
  return container;
}
