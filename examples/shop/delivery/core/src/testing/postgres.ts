// One database for the repository tests, brought up in Docker and migrated
// the way the service would be: the shipment's tables first, because a stop
// refers to a package. Without Docker the suites are skipped rather than
// failed: the domain and the use cases are covered without it.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { migrate } from "../pkg/migrate.ts";

export interface Database {
  pool: Pool;
  stop(): Promise<void>;
}

export async function startDatabase(): Promise<Database | undefined> {
  const container: StartedPostgreSqlContainer | undefined = await new PostgreSqlContainer("postgres:18-alpine").start().catch(() => undefined);
  if (!container) return undefined;
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  // The order service's table, stood in for: `packages.order_id` is a foreign
  // key into it, knowingly (core.0001), and the schema will not load without
  // something on the far end.
  await pool.query("CREATE TABLE orders (id text NOT NULL PRIMARY KEY)");
  const repositories = new URL("../infrastructure/repository/", import.meta.url);
  await migrate(pool, new URL("shipment/migrations", repositories).pathname);
  await migrate(pool, new URL("route/migrations", repositories).pathname);
  return {
    pool,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
