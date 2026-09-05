import type { Route } from "./route.ts";
import type { RouteClosed } from "./events/route-closed.ts";
import type { RoutePlanned } from "./events/route-planned.ts";
import type { RouteStarted } from "./events/route-started.ts";

/** Events a change produced go to the store with it, or neither lands. */
export type RouteEvent = RoutePlanned | RouteStarted | RouteClosed;

/** Where routes are kept. */
export interface RouteRepository {
  save(route: Route, ...events: RouteEvent[]): Promise<void>;
  byId(id: string): Promise<Route>;
  forDay(day: Date): Promise<Route[]>;
}
