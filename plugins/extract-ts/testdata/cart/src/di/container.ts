import { Container } from "inversify";
import type { Pricing } from "../application/basket/usecases/checkout/usecase.ts";
import { UseCase as Checkout } from "../application/basket/usecases/checkout/usecase.ts";
import { PricingClient } from "../infrastructure/pricing/client.ts";
import { TOKENS } from "./tokens.ts";

export function buildContainer(): Container {
  const container = new Container();
  container.bind<Pricing>(TOKENS.Pricing).to(PricingClient).inSingletonScope();
  container.bind(Checkout).toSelf();
  return container;
}
