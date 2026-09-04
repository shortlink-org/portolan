import type { Route } from "../../../../domain/route/route.ts";
import type { RouteRepository } from "../../../../domain/route/port.ts";

/** One route, as the depot reads it. */
export class UseCase {
  constructor(private readonly routes: RouteRepository) {}

  async handle(routeId: string): Promise<Route> {
    return this.routes.byId(routeId);
  }
}
