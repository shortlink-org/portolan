import { Route } from "../../../../domain/route/route.ts";
import { Stop } from "../../../../domain/route/stop.ts";
import { Window } from "../../../../domain/route/vo/window.ts";
import type { RouteRepository } from "../../../../domain/route/port.ts";
import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";

/** Builds a van's day out of the shipments waiting to go out. */
export class UseCase {
  constructor(
    private readonly routes: RouteRepository,
    private readonly shipments: ShipmentRepository,
    private readonly now: () => Date,
    private readonly newId: () => string,
  ) {}

  /**
   * The stop carries the address the shipment carries, which is the address
   * the order had at dispatch. Three copies of one string, each taken
   * deliberately: the route is planned against what was true when it was
   * planned.
   */
  async handle(vehicle: string, plannedFor: Date, shipmentIds: string[]): Promise<string> {
    const stops: Stop[] = [];
    let seq = 1;

    for (const shipmentId of shipmentIds) {
      const shipment = await this.shipments.byId(shipmentId);
      const window = new Window(plannedFor, new Date(plannedFor.getTime() + 4 * 60 * 60 * 1000));
      stops.push(new Stop(seq, shipment.id, shipment.shipTo, window));
      seq += 1;
    }

    const [route, planned] = Route.plan(this.newId(), vehicle, plannedFor, stops, this.now());
    await this.routes.save(route, planned);

    for (const shipmentId of shipmentIds) {
      const shipment = await this.shipments.byId(shipmentId);
      shipment.onRoute(route.id);
      await this.shipments.save(shipment);
    }

    return route.id;
  }
}
