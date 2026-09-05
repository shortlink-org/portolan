/** The van is out. The depot board stops showing the route as tomorrow's. */
export class RouteStarted {
  readonly name = "delivery.RouteStarted";
  readonly channel = "delivery.core.route";
  readonly routeId: string;
  readonly vehicle: string;
  readonly occurredAt: Date;

  constructor(routeId: string, vehicle: string, occurredAt: Date) {
    this.routeId = routeId;
    this.vehicle = vehicle;
    this.occurredAt = occurredAt;
  }
}
