// Runs the service. It does four things and no more: trace if told to,
// assemble, listen, and run the relay and the scheduled jobs beside the
// listener until told to stop. The bus is opened before listening, so a wrong
// NATS_URL is a service that never came up rather than one that took orders it
// could not deliver.
import "reflect-metadata";
import { startTracing } from "./telemetry/tracing.ts";

const stopTracing = process.env.TRACER_URI ? startTracing(process.env.TRACER_URI, process.env.SERVICE_NAME ?? "cart") : undefined;

const { buildContainer } = await import("./di/container.ts");
const { buildServer } = await import("./infrastructure/transport/http/server.ts");
const { BasketHandlers } = await import("./infrastructure/transport/http/basket/handlers.ts");
const { ExpireIdleBasketsJob } = await import("./infrastructure/transport/job/expire_idle_baskets.ts");
const { schedule } = await import("./infrastructure/transport/job/scheduler.ts");
const { migrate } = await import("./pkg/migrate.ts");
const { Relay } = await import("./pkg/outbox/relay.ts");
const { TOKENS } = await import("./di/tokens.ts");
type Bus = import("./pkg/messaging/bus.ts").Bus;
const { Pool } = await import("pg");

const databaseUrl = process.env.STORE_POSTGRES_URI ?? "postgres://cart:cart@localhost:5433/cart";
const container = buildContainer({ databaseUrl, authUrl: process.env.AUTH_URL, pricingAddr: process.env.PRICING_ADDR, natsUrl: process.env.NATS_URL });
const pool = container.get<InstanceType<typeof Pool>>(TOKENS.Pool);
await migrate(pool, new URL("./infrastructure/repository/basket/migrations", import.meta.url).pathname);

const app = buildServer(container.get(BasketHandlers));
const bus = container.get<Bus>(TOKENS.Bus);
await bus.ready();
const relay = new Relay(pool, bus);
const stopping = new AbortController();

const address = await app.listen({ port: Number(process.env.PORT ?? 8081), host: process.env.HOST ?? "127.0.0.1" });
console.log(`cart: listening on ${address}`);

const relaying = relay.run(stopping.signal).catch((err) => {
  console.error("cart: relay:", err);
  stopping.abort();
});
const stopJobs = schedule([container.get(ExpireIdleBasketsJob)], (job, err) => console.error(`cart: ${job.name}:`, err));

const stop = async (): Promise<void> => {
  stopJobs();
  stopping.abort();
  relay.stop();
  await app.close();
  await relaying;
  await bus.close();
  await pool.end();
  await stopTracing?.();
  console.log("cart: stopped");
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
