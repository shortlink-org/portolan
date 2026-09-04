/**
 * A van has a day's work. The stops are not on the event: whoever cares reads
 * the route, and a list that long on the bus would go stale in flight.
 */
export class RoutePlanned {
  readonly name = "delivery.RoutePlanned";
  readonly channel = "delivery.core.route";
  readonly routeId: string;
  readonly vehicle: string;
  readonly stops: number;
  readonly occurredAt: Date;

  constructor(routeId: string, vehicle: string, stops: number, occurredAt: Date) {
    this.routeId = routeId;
    this.vehicle = vehicle;
    this.stops = stops;
    this.occurredAt = occurredAt;
  }
}
