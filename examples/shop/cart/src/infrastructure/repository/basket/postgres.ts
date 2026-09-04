// The basket in rows, and the events it hands over in the outbox beside it,
// in one transaction. The version travels with every read and is checked by
// every write, so two tabs adding to one basket cannot both succeed with the
// first add silently disappearing.
import { randomUUID } from "node:crypto";
import { inject, injectable } from "inversify";
import type { Pool, PoolClient } from "pg";
import { TOKENS } from "../../../di/tokens.ts";
import { Basket } from "../../../domain/basket/basket.ts";
import { BasketError } from "../../../domain/basket/errors.ts";
import type { BasketEvent } from "../../../domain/basket/events/index.ts";
import { BasketItem } from "../../../domain/basket/item.ts";
import type { BasketRepository } from "../../../domain/basket/port.ts";
import { Currency } from "../../../domain/basket/vo/currency.ts";
import { Money } from "../../../domain/basket/vo/money.ts";
import { METADATA_EVENT_NAME } from "../../../pkg/messaging/bus.ts";
import { startPublish } from "../../../pkg/messaging/tracing.ts";
import { toWire, TOPIC } from "./dto.ts";

interface BasketRow {
  id: string;
  token: string;
  customer_id: string | null;
  currency: string | null;
  status: Basket["status"];
  touched_at: Date;
  version: number;
}

interface ItemRow {
  sku: string;
  quantity: number;
  unit_price_minor: string;
  currency: string;
}

@injectable()
export class PostgresBaskets implements BasketRepository {
  constructor(@inject(TOKENS.Pool) private readonly pool: Pool) {}

  async byId(id: string): Promise<Basket | null> {
    const rows = await this.pool.query<BasketRow>("SELECT * FROM baskets WHERE id = $1", [id]);
    const row = rows.rows[0];
    return row ? this.hydrate(row) : null;
  }

  async openFor(customerId: string): Promise<Basket | null> {
    const rows = await this.pool.query<BasketRow>("SELECT * FROM baskets WHERE customer_id = $1 AND status = 'open' ORDER BY touched_at DESC LIMIT 1", [customerId]);
    const row = rows.rows[0];
    return row ? this.hydrate(row) : null;
  }

  async idleSince(before: Date, limit: number): Promise<Basket[]> {
    const rows = await this.pool.query<BasketRow>("SELECT * FROM baskets WHERE status = 'open' AND touched_at < $1 ORDER BY touched_at LIMIT $2", [before, limit]);
    return Promise.all(rows.rows.map((row) => this.hydrate(row)));
  }

  async save(basket: Basket, ...events: BasketEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.write(client, basket);
      for (const event of events) await this.enqueue(client, event);
      await client.query("COMMIT");
      basket.version += 1;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async write(client: PoolClient, basket: Basket): Promise<void> {
    const next = basket.version + 1;
    if (basket.version === 0) {
      await client.query(
        "INSERT INTO baskets (id, token, customer_id, currency, status, touched_at, version) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [basket.id, basket.token, basket.customerId ?? null, basket.currency?.code ?? null, basket.status, basket.touchedAt, next],
      );
    } else {
      const updated = await client.query(
        "UPDATE baskets SET customer_id = $2, currency = $3, status = $4, touched_at = $5, version = $6 WHERE id = $1 AND version = $7",
        [basket.id, basket.customerId ?? null, basket.currency?.code ?? null, basket.status, basket.touchedAt, next, basket.version],
      );
      if (updated.rowCount !== 1) throw new BasketError("conflict", "the basket was changed by somebody else; read it again");
    }
    await client.query("DELETE FROM basket_items WHERE basket_id = $1", [basket.id]);
    for (const item of basket.items) {
      await client.query("INSERT INTO basket_items (basket_id, sku, quantity, unit_price_minor, currency) VALUES ($1, $2, $3, $4, $5)", [
        basket.id, item.sku, item.quantity, item.unitPrice.amountMinor, item.unitPrice.currency.code,
      ]);
    }
  }

  /** One row per event, with the publishing span's context on its metadata, so the consumer continues the trace. */
  private async enqueue(client: PoolClient, event: BasketEvent): Promise<void> {
    const metadata: Record<string, string> = { [METADATA_EVENT_NAME]: event.name };
    const span = startPublish(TOPIC, event.name, metadata);
    try {
      await client.query("INSERT INTO outbox (uuid, topic, payload, metadata, created_at) VALUES ($1, $2, $3, $4, $5)", [
        randomUUID(), TOPIC, JSON.stringify(toWire(event)), JSON.stringify(metadata), event.occurredAt,
      ]);
    } finally {
      span.end();
    }
  }

  private async hydrate(row: BasketRow): Promise<Basket> {
    const items = await this.pool.query<ItemRow>("SELECT sku, quantity, unit_price_minor, currency FROM basket_items WHERE basket_id = $1 ORDER BY sku", [row.id]);
    return new Basket(
      row.id,
      row.token,
      row.customer_id ?? undefined,
      row.currency ? new Currency(row.currency) : undefined,
      row.status,
      items.rows.map((i) => new BasketItem(i.sku, i.quantity, Money.of(Number(i.unit_price_minor), i.currency))),
      row.touched_at,
      row.version,
    );
  }
}
