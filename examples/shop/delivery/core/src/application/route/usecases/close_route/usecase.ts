import type { RouteRepository } from "../../../../domain/route/port.ts";

/** Ends the day, whatever is left undone. */
export class UseCase {
  constructor(
    private readonly routes: RouteRepository,
    private readonly now: () => Date,
  ) {}

  async handle(routeId: string): Promise<void> {
    const route = await this.routes.byId(routeId);
    const closed = route.close(this.now());
    await this.routes.save(route, closed);
  }
}
