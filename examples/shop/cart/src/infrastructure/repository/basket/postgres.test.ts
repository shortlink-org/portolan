import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Basket } from "../../../domain/basket/basket.ts";
import { LineItem } from "../../../domain/basket/vo/line-item.ts";
import { Money } from "../../../domain/basket/vo/money.ts";
import { migrate } from "../../../pkg/migrate.ts";
import { PostgresBaskets } from "./postgres.ts";

const now = new Date("2026-09-04T12:00:00Z");

// Without Docker the suite is skipped rather than failed: the domain and the
// use cases are covered without it, and this is the one file that needs it.
// Started here, at the top, so the skip below can see whether it came up.
const container: StartedPostgreSqlContainer | undefined = await new PostgreSqlContainer("postgres:18-alpine").start().catch(() => undefined);
let pool: Pool;
let repo: PostgresBaskets;

beforeAll(async () => {
  if (!container) return;
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool, new URL("./migrations", import.meta.url).pathname);
  repo = new PostgresBaskets(pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.skipIf(!container)("PostgresBaskets", () => {
  it("keeps a basket and its lines, and the events in the outbox beside them", async () => {
    const [basket, created] = Basket.create("11111111-1111-4111-8111-111111111111", "tok-1", undefined, now);
    const added = basket.addItem(new LineItem("a", 2, Money.of(500, "EUR")), now);
    await repo.save(basket, created, added);

    const read = await repo.byId(basket.id);
    expect(read?.items.map((i) => [i.sku, i.quantity, i.unitPrice.amountMinor])).toEqual([["a", 2, 500]]);
    expect(read?.currency?.code).toBe("EUR");
    expect(read?.version).toBe(1);

    const outbox = await pool.query<{ topic: string; metadata: Record<string, string> }>("SELECT topic, metadata FROM outbox ORDER BY id");
    expect(outbox.rows.map((r) => `${r.topic}:${r.metadata.event_name}`)).toEqual(["shop.cart.basket:cart.BasketCreated", "shop.cart.basket:cart.BasketItemAdded"]);
  });

  it("refuses a write from a stale read", async () => {
    const [basket] = Basket.create("22222222-2222-4222-8222-222222222222", "tok-2", undefined, now);
    await repo.save(basket);
    const one = (await repo.byId(basket.id))!;
    const two = (await repo.byId(basket.id))!;
    one.addItem(new LineItem("a", 1, Money.of(1, "EUR")), now);
    await repo.save(one);
    two.addItem(new LineItem("b", 1, Money.of(1, "EUR")), now);
    await expect(repo.save(two)).rejects.toMatchObject({ code: "conflict" });
  });

  it("finds the customer's open basket and the idle ones", async () => {
    const [mine] = Basket.create("33333333-3333-4333-8333-333333333333", "tok-3", "u1", new Date("2026-09-01T00:00:00Z"));
    await repo.save(mine);
    expect((await repo.openFor("u1"))?.id).toBe(mine.id);
    expect((await repo.idleSince(new Date("2026-09-03T00:00:00Z"), 10)).map((b) => b.id)).toContain(mine.id);
  });
});
