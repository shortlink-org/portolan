import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Parcel } from "../../../domain/shipment/parcel.ts";
import { Scan } from "../../../domain/shipment/scan.ts";
import { Shipment } from "../../../domain/shipment/shipment.ts";
import { Address } from "../../../domain/shipment/vo/address.ts";
import { TrackingCode } from "../../../domain/shipment/vo/tracking-code.ts";
import { type Database, startDatabase } from "../../../testing/postgres.ts";
import { PostgresShipments } from "./postgres.ts";

const now = new Date("2026-09-08T09:00:00Z");
const home = new Address("1 High St", "", "Leeds", "LS1 1AA", "GB");

const db: Database | undefined = await startDatabase();
let repo: PostgresShipments;

beforeAll(async () => {
  if (!db) return;
  await db.pool.query("INSERT INTO orders (id) VALUES ('o-1'), ('o-2'), ('o-3')");
  repo = new PostgresShipments(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

describe.skipIf(!db)("PostgresShipments", () => {
  it("keeps a shipment, its parcels and its address, and the events in the outbox beside them", async () => {
    const shipment = new Shipment("s-1", "o-1", home, [new Parcel("p-1", 1200, "books"), new Parcel("p-2", 300, "a lamp")]);
    const released = shipment.release(now);
    const dispatched = shipment.dispatch(new TrackingCode("abc123xyz"), now);
    await repo.save(shipment, released, dispatched);

    const read = await repo.byId("s-1");
    expect(read.status).toBe("dispatched");
    expect(read.tracking?.value).toBe("ABC123XYZ");
    expect(read.shipTo.toString()).toBe("1 High St, Leeds, LS1 1AA, GB");
    expect(read.parcels.map((p) => [p.id, p.weightG, p.contents])).toEqual([["p-1", 1200, "books"], ["p-2", 300, "a lamp"]]);

    const packages = await db!.pool.query<{ dispatched_at: Date }>("SELECT dispatched_at FROM packages WHERE id = 's-1'");
    expect(packages.rows[0]?.dispatched_at).toEqual(now);
    const outbox = await db!.pool.query<{ topic: string; metadata: Record<string, string> }>("SELECT topic, metadata FROM outbox ORDER BY id");
    expect(outbox.rows.map((r) => `${r.topic}:${r.metadata.event_name}`)).toEqual([
      "delivery.core.shipment:delivery.ShipmentReleased",
      "delivery.core.shipment:delivery.ShipmentDispatched",
    ]);
  });

  it("appends the scans a save brings and never writes one twice", async () => {
    const shipment = new Shipment("s-2", "o-2", home, [new Parcel("p-3", 500, "socks")]);
    shipment.release(now);
    shipment.dispatch(new TrackingCode("scan00001"), now);
    await repo.save(shipment);

    const first = await repo.byId("s-2");
    first.record(new Scan("p-3", "depot", new Date("2026-09-08T10:00:00Z")));
    await repo.save(first);
    await repo.save(first);
    const second = await repo.byId("s-2");
    second.record(new Scan("p-3", "van", new Date("2026-09-08T11:00:00Z")));
    await repo.save(second);

    const read = await repo.byId("s-2");
    expect(read.status).toBe("in-transit");
    expect(read.scans.map((s) => s.location)).toEqual(["depot", "van"]);
  });

  it("finds a shipment by its tracking code and by its order", async () => {
    const shipment = new Shipment("s-3", "o-3", home, [new Parcel("p-4", 100, "a card")]);
    shipment.release(now);
    shipment.dispatch(new TrackingCode("find0001"), now);
    await repo.save(shipment);

    expect((await repo.byTracking(" find0001 ")).id).toBe("s-3");
    expect((await repo.byOrder("o-3")).id).toBe("s-3");
    await expect(repo.byId("s-none")).rejects.toThrow("no shipment s-none");
  });
});
