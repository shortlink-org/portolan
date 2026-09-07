// The route in rows, and the events it hands over in the outbox beside it,
// in one transaction. The stops are rewritten with the route: their order is
// the route, and a stop is only ever marked done, never moved.
import type { Pool, PoolClient } from "pg";
import type { RouteEvent, RouteRepository } from "../../../domain/route/port.ts";
import { Route } from "../../../domain/route/route.ts";
import type { RouteStatus } from "../../../domain/route/status.ts";
import { Stop } from "../../../domain/route/stop.ts";
import { Window } from "../../../domain/route/vo/window.ts";
import { enqueue } from "../outbox.ts";
import { readAddress, storeAddress } from "../shipment/dto.ts";
import { day, type RouteRow, startOf, type StopRow, TOPIC, toWire } from "./dto.ts";

export class PostgresRoutes implements RouteRepository {
  constructor(private readonly pool: Pool) {}

  async byId(id: string): Promise<Route> {
    const rows = await this.pool.query<RouteRow>("SELECT id, vehicle, planned_for::text AS planned_for, status FROM routes WHERE id = $1", [id]);
    const row = rows.rows[0];
    if (!row) throw new Error(`no route ${id}`);
    return this.hydrate(row);
  }

  async forDay(at: Date): Promise<Route[]> {
    const rows = await this.pool.query<RouteRow>(
      "SELECT id, vehicle, planned_for::text AS planned_for, status FROM routes WHERE planned_for = $1 ORDER BY id",
      [day(at)],
    );
    return Promise.all(rows.rows.map((row) => this.hydrate(row)));
  }

  async save(route: Route, ...events: RouteEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.write(client, route);
      for (const event of events) await enqueue(client, TOPIC, event, toWire(event));
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async write(client: PoolClient, route: Route): Promise<void> {
    await client.query(
      "INSERT INTO routes (id, vehicle, planned_for, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status",
      [route.id, route.vehicle, day(route.plannedFor), route.status],
    );
    await client.query("DELETE FROM route_stops WHERE route_id = $1", [route.id]);
    for (const stop of route.stops) {
      await client.query(
        "INSERT INTO route_stops (route_id, seq, shipment_id, address, window_from, window_to, done) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [route.id, stop.seq, stop.shipmentId, storeAddress(stop.address), stop.window.from, stop.window.to, stop.done],
      );
    }
  }

  private async hydrate(row: RouteRow): Promise<Route> {
    const stops = await this.pool.query<StopRow>("SELECT * FROM route_stops WHERE route_id = $1 ORDER BY seq", [row.id]);
    return Route.restore(
      row.id,
      row.vehicle,
      startOf(row.planned_for),
      stops.rows.map((s) => {
        const stop = new Stop(s.seq, s.shipment_id, readAddress(s.address), new Window(s.window_from, s.window_to));
        if (s.done) stop.complete();
        return stop;
      }),
      row.status as RouteStatus,
    );
  }
}
