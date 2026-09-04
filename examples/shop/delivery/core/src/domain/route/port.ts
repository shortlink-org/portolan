import type { Route } from "./route.ts";
import type { RoutePlanned } from "./events/route-planned.ts";

/** Where routes are kept. */
export interface RouteRepository {
  save(route: Route, ...events: RoutePlanned[]): Promise<void>;
  byId(id: string): Promise<Route>;
  forDay(day: Date): Promise<Route[]>;
}
