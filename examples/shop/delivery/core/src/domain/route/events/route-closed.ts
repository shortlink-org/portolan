/**
 * The day is over. How many stops were left undone is on the event, because
 * that is the one number whoever plans tomorrow needs and should not have to
 * come back for.
 */
export class RouteClosed {
  readonly name = "delivery.RouteClosed";
  readonly channel = "delivery.core.route";
  readonly routeId: string;
  readonly vehicle: string;
  readonly undone: number;
  readonly occurredAt: Date;

  constructor(routeId: string, vehicle: string, undone: number, occurredAt: Date) {
    this.routeId = routeId;
    this.vehicle = vehicle;
    this.undone = undone;
    this.occurredAt = occurredAt;
  }
}
