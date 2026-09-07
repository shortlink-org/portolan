// The shipment in rows, and the events it hands over in the outbox beside it,
// in one transaction. A package row is written whole every time and the
// parcels once - a parcel never changes - while the scans are appended: the
// store holds a prefix of the aggregate's history, and a save writes the
// rest of it.
import type { Pool, PoolClient } from "pg";
import { Parcel } from "../../../domain/shipment/parcel.ts";
import type { ShipmentEvent, ShipmentRepository } from "../../../domain/shipment/port.ts";
import { Scan } from "../../../domain/shipment/scan.ts";
import { Shipment } from "../../../domain/shipment/shipment.ts";
import type { ShipmentStatus } from "../../../domain/shipment/status.ts";
import { TrackingCode } from "../../../domain/shipment/vo/tracking-code.ts";
import { enqueue } from "../outbox.ts";
import { type PackageRow, type ParcelRow, readAddress, type ScanRow, storeAddress, TOPIC, toWire } from "./dto.ts";

export class PostgresShipments implements ShipmentRepository {
  constructor(private readonly pool: Pool) {}

  async byId(id: string): Promise<Shipment> {
    const rows = await this.pool.query<PackageRow>("SELECT * FROM packages WHERE id = $1", [id]);
    return this.one(rows.rows[0], `no shipment ${id}`);
  }

  async byTracking(tracking: string): Promise<Shipment> {
    const code = new TrackingCode(tracking).value;
    const rows = await this.pool.query<PackageRow>("SELECT * FROM packages WHERE tracking = $1", [code]);
    return this.one(rows.rows[0], `no shipment tracked as ${code}`);
  }

  async byOrder(orderId: string): Promise<Shipment> {
    const rows = await this.pool.query<PackageRow>("SELECT * FROM packages WHERE order_id = $1 ORDER BY id LIMIT 1", [orderId]);
    return this.one(rows.rows[0], `no shipment for order ${orderId}`);
  }

  async save(shipment: Shipment, ...events: ShipmentEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.write(client, shipment, events);
      for (const event of events) await enqueue(client, TOPIC, event, toWire(event));
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async write(client: PoolClient, shipment: Shipment, events: ShipmentEvent[]): Promise<void> {
    // The one column no field carries: when the parcels left. It is true
    // from the moment the dispatch is a fact, so it is read off the event
    // that made it one, and kept once written.
    const dispatchedAt = events.find((event) => event.name === "delivery.ShipmentDispatched")?.occurredAt ?? null;
    await client.query(
      `INSERT INTO packages (id, order_id, ship_to, status, tracking, route_id, dispatched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, tracking = EXCLUDED.tracking, route_id = EXCLUDED.route_id,
                                     dispatched_at = COALESCE(packages.dispatched_at, EXCLUDED.dispatched_at)`,
      [shipment.id, shipment.orderId, storeAddress(shipment.shipTo), shipment.status, shipment.tracking?.value ?? null, shipment.routeId ?? null, dispatchedAt],
    );
    for (const parcel of shipment.parcels) {
      await client.query("INSERT INTO parcels (id, package_id, weight_g, contents) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING", [
        parcel.id, shipment.id, parcel.weightG, parcel.contents,
      ]);
    }
    const stored = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM scans s JOIN parcels p ON p.id = s.parcel_id WHERE p.package_id = $1",
      [shipment.id],
    );
    for (const scan of shipment.scans.slice(stored.rows[0]?.n ?? 0)) {
      await client.query("INSERT INTO scans (parcel_id, location, scanned_at) VALUES ($1, $2, $3)", [scan.parcelId, scan.location, scan.scannedAt]);
    }
  }

  private one(row: PackageRow | undefined, missing: string): Promise<Shipment> {
    if (!row) throw new Error(missing);
    return this.hydrate(row);
  }

  private async hydrate(row: PackageRow): Promise<Shipment> {
    const parcels = await this.pool.query<ParcelRow>("SELECT * FROM parcels WHERE package_id = $1 ORDER BY id", [row.id]);
    const scans = await this.pool.query<ScanRow>(
      "SELECT s.parcel_id, s.location, s.scanned_at FROM scans s JOIN parcels p ON p.id = s.parcel_id WHERE p.package_id = $1 ORDER BY s.id",
      [row.id],
    );
    const shipment = new Shipment(
      row.id,
      row.order_id,
      readAddress(row.ship_to),
      parcels.rows.map((p) => new Parcel(p.id, p.weight_g, p.contents)),
    );
    shipment.status = row.status as ShipmentStatus;
    if (row.tracking) shipment.tracking = new TrackingCode(row.tracking);
    if (row.route_id) shipment.routeId = row.route_id;
    shipment.scans.push(...scans.rows.map((s) => new Scan(s.parcel_id, s.location, s.scanned_at)));
    return shipment;
  }
}
