// The relay: reads the outbox and hands what is in it to the bus, marking each
// row published. It runs for as long as the service does, and its failure is
// as fatal as the listener's - a service that serves but never delivers what
// it recorded is worse than one that is plainly down.
import type { Pool } from "pg";
import { type Bus, eventNameOf, type Message } from "../messaging/bus.ts";
import { startRelay } from "../messaging/tracing.ts";

const POLL_MS = 200;
const BATCH = 50;

export class Relay {
  private readonly pool: Pool;
  private readonly bus: Bus;
  private stopped = false;

  constructor(pool: Pool, bus: Bus) {
    this.pool = pool;
    this.bus = bus;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.stopped) {
      const delivered = await this.once();
      if (delivered === 0) await sleep(POLL_MS, signal);
    }
  }

  /** One batch, oldest first, each row in its own transaction so a slow subscriber holds up nothing else. */
  async once(): Promise<number> {
    const rows = await this.pool.query<{ id: string; uuid: string; topic: string; payload: unknown; metadata: Record<string, string> }>(
      "SELECT id, uuid, topic, payload, metadata FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT $1",
      [BATCH],
    );
    for (const row of rows.rows) {
      // A copy of the metadata: the span moves the trace context on to itself
      // for whoever reads the message, and the row keeps what was written.
      const message: Message = { uuid: row.uuid, topic: row.topic, payload: row.payload, metadata: { ...row.metadata } };
      const span = startRelay(this.bus.system, message.topic, eventNameOf(message), message.metadata);
      try {
        await this.bus.publish(message);
        await this.pool.query("UPDATE outbox SET published_at = now() WHERE id = $1", [row.id]);
      } finally {
        span.end();
      }
    }
    return rows.rowCount ?? 0;
  }

  stop(): void {
    this.stopped = true;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
