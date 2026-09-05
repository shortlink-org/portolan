// Runs the service. It does three things and no more: trace if told to,
// assemble, and listen. There is no database to migrate and no relay to run -
// this service owns nothing to write down (ADR bff.0002).
import { startTracing } from "./telemetry/tracing.ts";

const stopTracing = process.env.TRACER_URI ? startTracing(process.env.TRACER_URI, process.env.SERVICE_NAME ?? "bff") : undefined;

const { createServer } = await import("node:http");
const { buildPorts } = await import("./di/container.ts");
const { buildServer } = await import("./infrastructure/transport/graphql/server.ts");

const ports = buildPorts({
  authUrl: process.env.AUTH_URL ?? "http://127.0.0.1:8080",
  cartUrl: process.env.CART_URL ?? "http://127.0.0.1:8081",
  omsAddr: process.env.OMS_ADDR ?? "http://127.0.0.1:8082",
  deliveryAddr: process.env.DELIVERY_ADDR ?? "http://127.0.0.1:8083",
  natsUrl: process.env.NATS_URL,
});

const yoga = buildServer(ports);
const server = createServer(yoga);
const port = Number(process.env.PORT ?? 8085);
const host = process.env.HOST ?? "127.0.0.1";

await new Promise<void>((resolve) => server.listen(port, host, resolve));
console.log(`bff: listening on http://${host}:${port}${yoga.graphqlEndpoint}`);

const stop = async (): Promise<void> => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await stopTracing?.();
  console.log("bff: stopped");
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
