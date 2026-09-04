// Runs the service. It does four things and no more: trace if told to,
// assemble, listen, and run the relay and the sweep beside the listener until
// told to stop.
import "reflect-metadata";
import { startTracing } from "./telemetry/tracing.ts";

const stopTracing = process.env.TRACER_URI ? startTracing(process.env.TRACER_URI, process.env.SERVICE_NAME ?? "cart") : undefined;

const { buildContainer } = await import("./di/container.ts");
const { buildServer } = await import("./infrastructure/transport/http/server.ts");
const { BasketHandlers } = await import("./infrastructure/transport/http/basket/handlers.ts");
const { UseCase: ExpireIdleBaskets } = await import("./application/basket/usecases/expire_idle_baskets/usecase.ts");
const { migrate } = await import("./pkg/migrate.ts");
const { Relay } = await import("./pkg/outbox/relay.ts");
const { TOKENS } = await import("./di/tokens.ts");
const { Bus } = await import("./pkg/messaging/bus.ts");
const { Pool } = await import("pg");

const databaseUrl = process.env.STORE_POSTGRES_URI ?? "postgres://cart:cart@localhost:5433/cart";
const container = buildContainer({ databaseUrl, authUrl: process.env.AUTH_URL, pricingAddr: process.env.PRICING_ADDR });
const pool = container.get<InstanceType<typeof Pool>>(TOKENS.Pool);
await migrate(pool, new URL("./infrastructure/repository/basket/migrations", import.meta.url).pathname);

const app = buildServer(container.get(BasketHandlers));
const relay = new Relay(pool, container.get<InstanceType<typeof Bus>>(TOKENS.Bus));
const sweep = container.get(ExpireIdleBaskets);
const stopping = new AbortController();

const address = await app.listen({ port: Number(process.env.PORT ?? 8081), host: process.env.HOST ?? "127.0.0.1" });
console.log(`cart: listening on ${address}`);

const relaying = relay.run(stopping.signal).catch((err) => {
  console.error("cart: relay:", err);
  stopping.abort();
});
const sweeping = setInterval(() => {
  sweep.handle().catch((err) => console.error("cart: sweep:", err));
}, 60_000);

const stop = async (): Promise<void> => {
  clearInterval(sweeping);
  stopping.abort();
  relay.stop();
  await app.close();
  await relaying;
  await pool.end();
  await stopTracing?.();
  console.log("cart: stopped");
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
