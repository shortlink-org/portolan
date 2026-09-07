import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Route } from "../../../domain/route/route.ts";
import { Stop } from "../../../domain/route/stop.ts";
import { Window } from "../../../domain/route/vo/window.ts";
import { Parcel } from "../../../domain/shipment/parcel.ts";
import { Shipment } from "../../../domain/shipment/shipment.ts";
import { Address } from "../../../domain/shipment/vo/address.ts";
import { type Database, startDatabase } from "../../../testing/postgres.ts";
import { PostgresShipments } from "../shipment/postgres.ts";
import { PostgresRoutes } from "./postgres.ts";

const now = new Date("2026-09-08T09:00:00Z");
const day = new Date("2026-09-09T00:00:00Z");
const home = new Address("1 High St", "", "Leeds", "LS1 1AA", "GB");

const db: Database | undefined = await startDatabase();
let repo: PostgresRoutes;

beforeAll(async () => {
  if (!db) return;
  await db.pool.query("INSERT INTO orders (id) VALUES ('o-1')");
  const shipment = new Shipment("s-1", "o-1", home, [new Parcel("p-1", 100, "a card")]);
  await new PostgresShipments(db.pool).save(shipment);
  repo = new PostgresRoutes(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

describe.skipIf(!db)("PostgresRoutes", () => {
  it("keeps a route and its stops in order, and the events in the outbox beside them", async () => {
    const window = new Window(day, new Date(day.getTime() + 4 * 60 * 60 * 1000));
    const [route, planned] = Route.plan("r-1", "van-7", day, [new Stop(1, "s-1", home, window)], now);
    await repo.save(route, planned);

    const read = await repo.byId("r-1");
    expect(read.vehicle).toBe("van-7");
    expect(read.plannedFor).toEqual(day);
    expect(read.status).toBe("planned");
    expect(read.stops.map((s) => [s.seq, s.shipmentId, s.address.city, s.window.from, s.done])).toEqual([[1, "s-1", "Leeds", day, false]]);

    const outbox = await db!.pool.query<{ topic: string; metadata: Record<string, string> }>("SELECT topic, metadata FROM outbox ORDER BY id");
    expect(outbox.rows.map((r) => `${r.topic}:${r.metadata.event_name}`)).toEqual(["delivery.core.route:delivery.RoutePlanned"]);
  });

  it("writes the day's progress: the status, and the stops that are done", async () => {
    const read = await repo.byId("r-1");
    const started = read.start(now);
    read.stops[0]!.complete();
    await repo.save(read, started);

    const again = await repo.byId("r-1");
    expect(again.status).toBe("driving");
    expect(again.stops[0]?.done).toBe(true);
  });

  it("lists the routes of a day and no other", async () => {
    expect((await repo.forDay(day)).map((r) => r.id)).toEqual(["r-1"]);
    expect(await repo.forDay(new Date("2026-09-10T00:00:00Z"))).toEqual([]);
    await expect(repo.byId("r-none")).rejects.toThrow("no route r-none");
  });
});
