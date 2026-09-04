// The assembly. Every port a use case declares is bound here to what fills it,
// and this is the one place in the tree that knows both sides exist. Read
// top to bottom it is the wiring diagram; the catalog reads it the same way.
import { randomBytes, randomUUID } from "node:crypto";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { Container } from "inversify";
import { Pool } from "pg";
import { UseCase as AddItem } from "../application/basket/usecases/add_item/usecase.ts";
import { UseCase as Checkout, type Pricing, type Sessions } from "../application/basket/usecases/checkout/usecase.ts";
import { UseCase as CreateBasket } from "../application/basket/usecases/create_basket/usecase.ts";
import { UseCase as ExpireIdleBaskets } from "../application/basket/usecases/expire_idle_baskets/usecase.ts";
import { UseCase as GetBasket } from "../application/basket/usecases/get_basket/usecase.ts";
import { UseCase as MergeBaskets } from "../application/basket/usecases/merge_baskets/usecase.ts";
import { UseCase as RemoveItem } from "../application/basket/usecases/remove_item/usecase.ts";
import type { BasketRepository } from "../domain/basket/port.ts";
import { AuthSessions, PermissiveSessions } from "../infrastructure/auth/client.ts";
import { PermissivePricing, PricingClient } from "../infrastructure/pricing/client.ts";
import { PostgresBaskets } from "../infrastructure/repository/basket/postgres.ts";
import { BasketHandlers } from "../infrastructure/transport/http/basket/handlers.ts";
import { type Bus, InProcBus } from "../pkg/messaging/bus.ts";
import { NatsBus } from "../pkg/messaging/nats.ts";
import { TOKENS, type NewId, type NewToken, type Now } from "./tokens.ts";

export interface Settings {
  databaseUrl: string;
  /** Where auth is; unset, every session is live (cart.0004). */
  authUrl?: string | undefined;
  /** Where pricing is; unset, the quote is the sum of the lines. */
  pricingAddr?: string | undefined;
  /** Where NATS is; unset, the bus is in process and no event leaves the service (cart.0008). */
  natsUrl?: string | undefined;
}

export function buildContainer(settings: Settings): Container {
  const container = new Container({ defaultScope: "Singleton" });

  container.bind<Pool>(TOKENS.Pool).toConstantValue(new Pool({ connectionString: settings.databaseUrl }));
  container.bind<Now>(TOKENS.Now).toConstantValue(() => new Date());
  container.bind<NewId>(TOKENS.NewId).toConstantValue(() => randomUUID());
  container.bind<NewToken>(TOKENS.NewToken).toConstantValue(() => randomBytes(32).toString("base64url"));

  container.bind<BasketRepository>(TOKENS.BasketRepository).to(PostgresBaskets);

  // The bus. Over NATS when there is one to talk to; in process otherwise,
  // and the relay cannot tell which it was handed.
  if (settings.natsUrl) {
    container.bind<Bus>(TOKENS.Bus).toConstantValue(new NatsBus(settings.natsUrl, "cart"));
  } else {
    container.bind<Bus>(TOKENS.Bus).toConstantValue(new InProcBus());
  }

  // The peers. A stand-in is assembly's choice and the use case cannot tell.
  if (settings.authUrl) {
    container.bind<Sessions>(TOKENS.Sessions).toConstantValue(new AuthSessions(settings.authUrl));
  } else {
    container.bind<Sessions>(TOKENS.Sessions).to(PermissiveSessions);
  }
  if (settings.pricingAddr) {
    container.bind<Pricing>(TOKENS.Pricing).toConstantValue(new PricingClient(createGrpcTransport({ baseUrl: settings.pricingAddr })));
  } else {
    container.bind<Pricing>(TOKENS.Pricing).to(PermissivePricing);
  }

  container.bind(CreateBasket).toSelf();
  container.bind(GetBasket).toSelf();
  container.bind(AddItem).toSelf();
  container.bind(RemoveItem).toSelf();
  container.bind(MergeBaskets).toSelf();
  container.bind(Checkout).toSelf();
  container.bind(ExpireIdleBaskets).toSelf();
  container.bind(BasketHandlers).toSelf();

  return container;
}
