import type { RouteRepository } from "../../../../domain/route/port.ts";
import type { Route } from "../../../../domain/route/route.ts";
import type { RouteStatus } from "../../../../domain/route/status.ts";

/**
 * One route, as the depot reads it: the van, the day, and the stops in the
 * order they are driven, each with the address printed as a label would.
 */
export interface RouteView {
  routeId: string;
  vehicle: string;
  plannedFor: string;
  status: RouteStatus;
  stops: { seq: number; shipmentId: string; address: string; windowFrom: string; windowTo: string; done: boolean }[];
}

/** One route, as the depot reads it. */
export class UseCase {
  constructor(private readonly routes: RouteRepository) {}

  async handle(routeId: string): Promise<RouteView> {
    const route = await this.routes.byId(routeId);

    return viewOf(route);
  }
}

function viewOf(route: Route): RouteView {
  return {
    routeId: route.id,
    vehicle: route.vehicle,
    plannedFor: route.plannedFor.toISOString(),
    status: route.status,
    stops: route.stops.map((stop) => ({
      seq: stop.seq,
      shipmentId: stop.shipmentId,
      address: stop.address.toString(),
      windowFrom: stop.window.from.toISOString(),
      windowTo: stop.window.to.toISOString(),
      done: stop.done,
    })),
  };
}
