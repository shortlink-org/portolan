import { RoutePlanned } from "./events/route-planned.ts";
import { canMove, type RouteStatus } from "./status.ts";
import { Stop } from "./stop.ts";

/**
 * One van, one day, in the order the stops are driven.
 *
 * The order of the stops is the route: changing it is planning a new one, not
 * editing this. A closed route is history.
 */
export class Route {
  readonly id: string;
  readonly vehicle: string;
  readonly plannedFor: Date;
  readonly stops: Stop[];
  status: RouteStatus = "planned";

  private constructor(id: string, vehicle: string, plannedFor: Date, stops: Stop[]) {
    if (stops.length === 0) throw new Error("a route with no stops is not a route");
    this.id = id;
    this.vehicle = vehicle;
    this.plannedFor = plannedFor;
    this.stops = stops;
  }

  /** Plans a day, and says so: the route and the event it raised. */
  static plan(id: string, vehicle: string, plannedFor: Date, stops: Stop[], at: Date): [Route, RoutePlanned] {
    const route = new Route(id, vehicle, plannedFor, stops);

    return [route, new RoutePlanned(route.id, route.vehicle, route.stops.length, at)];
  }

  /** Rebuilds a route the store already holds; nothing is raised. */
  static restore(id: string, vehicle: string, plannedFor: Date, stops: Stop[], status: RouteStatus): Route {
    const route = new Route(id, vehicle, plannedFor, stops);
    route.status = status;

    return route;
  }

  private moveTo(next: RouteStatus): void {
    if (!canMove(this.status, next)) {
      throw new Error(`a ${this.status} route does not become ${next}`);
    }
    this.status = next;
  }

  /** The van is out. */
  start(): void {
    this.moveTo("driving");
  }

  /** The day is over, whatever is left undone. */
  close(): void {
    this.moveTo("closed");
  }
}
