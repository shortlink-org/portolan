// The worker: migrates the store, then reads the facts delivery reacts to off
// the bus and hands them to the policies. There is still no server here - the
// gRPC handlers wait for one - so this process listens to the bus and nothing
// else.
//
// STORE_POSTGRES_URI is the database; in the example estate it is the order
// service's, knowingly (core.0001), with delivery's tables in a schema of their
// own named by the connection's search_path. NATS_URL is the bus.
// PAYMENTS_ADDR is the ledger capture is asked of (core.0003).
import { Pool } from "pg";
import { providePolicies } from "./di/providers.ts";
import { JetStreamFacts, ORDER_SUBJECT, PAYMENT_SUBJECT } from "./infrastructure/bus/jetstream.ts";
import { migrate } from "./pkg/migrate.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const pool = new Pool({ connectionString: required("STORE_POSTGRES_URI") });
// The migrations are SQL, not compiled: read from the source tree beside dist.
const repositories = new URL("../src/infrastructure/repository/", import.meta.url);
await migrate(pool, new URL("shipment/migrations", repositories).pathname);
await migrate(pool, new URL("route/migrations", repositories).pathname);

const policies = providePolicies(pool, { ledgerAddr: required("PAYMENTS_ADDR") });
const bus = await JetStreamFacts.connect(required("NATS_URL"));
await bus.subscribe({ subject: ORDER_SUBJECT, event: "oms.OrderConfirmed", listener: (fact) => policies.createShipment.handle(fact) });
await bus.subscribe({ subject: PAYMENT_SUBJECT, event: "ledger.PaymentCaptured", listener: (fact) => policies.releaseShipment.handle(fact) });
console.log("delivery core: reading oms.OrderConfirmed and ledger.PaymentCaptured");

const stop = async () => {
  await bus.close();
  await pool.end();
  process.exit(0);
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
