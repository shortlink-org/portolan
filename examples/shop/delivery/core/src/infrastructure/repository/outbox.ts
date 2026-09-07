// Events awaiting the relay, written in the transaction that changed the
// aggregate: the row and the fact that it changed land together or not at
// all. Shared by both repositories because there is one outbox per database,
// not one per aggregate - the relay reads a table, not a package.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

/** The metadata key the subscribers dispatch on; the same one the cart writes. */
export const METADATA_EVENT_NAME = "event_name";

export interface Outgoing {
  readonly name: string;
  readonly occurredAt: Date;
}

/** One row per event, in the caller's transaction. */
export async function enqueue(client: PoolClient, topic: string, event: Outgoing, payload: Record<string, unknown>): Promise<void> {
  await client.query("INSERT INTO outbox (uuid, topic, payload, metadata, created_at) VALUES ($1, $2, $3, $4, $5)", [
    randomUUID(), topic, JSON.stringify(payload), JSON.stringify({ [METADATA_EVENT_NAME]: event.name }), event.occurredAt,
  ]);
}
