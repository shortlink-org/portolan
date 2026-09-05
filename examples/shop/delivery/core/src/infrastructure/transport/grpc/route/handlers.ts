import type { UseCase as CloseRoute } from "../../../../application/route/usecases/close_route/usecase.ts";
import type { UseCase as GetRoute } from "../../../../application/route/usecases/get_route/usecase.ts";
import type { UseCase as PlanRoute } from "../../../../application/route/usecases/plan_route/usecase.ts";
import type { UseCase as StartRoute } from "../../../../application/route/usecases/start_route/usecase.ts";

/** The way in for routes: one method per rpc of delivery.v1.RouteService. */
export class RouteHandlers {
  constructor(
    private readonly planning: PlanRoute,
    private readonly starting: StartRoute,
    private readonly closing: CloseRoute,
    private readonly lookup: GetRoute,
  ) {}

  /** Builds a van's day out of the shipments waiting to go out. */
  async planRoute(vehicle: string, plannedFor: string, shipmentIds: string[]): Promise<unknown> {
    const routeId = await this.planning.handle(vehicle, new Date(plannedFor), shipmentIds);

    return { routeId, stops: shipmentIds.length };
  }

  /** The van is out. */
  async startRoute(routeId: string): Promise<unknown> {
    await this.starting.handle(routeId);

    return { routeId };
  }

  /** Ends the day, whatever is left undone. */
  async closeRoute(routeId: string): Promise<unknown> {
    await this.closing.handle(routeId);

    return { routeId };
  }

  /** One route, in the order it is driven. */
  async getRoute(routeId: string): Promise<unknown> {
    const route = await this.lookup.handle(routeId);

    return {
      routeId: route.routeId,
      vehicle: route.vehicle,
      status: route.status,
      stops: route.stops.map((stop) => ({
        seq: stop.seq,
        shipmentId: stop.shipmentId,
        address: stop.address,
        done: stop.done,
      })),
    };
  }
}
