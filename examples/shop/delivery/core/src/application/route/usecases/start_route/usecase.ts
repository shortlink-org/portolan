import type { RouteRepository } from "../../../../domain/route/port.ts";

/** The van is out. */
export class UseCase {
  constructor(
    private readonly routes: RouteRepository,
    private readonly now: () => Date,
  ) {}

  async handle(routeId: string): Promise<void> {
    const route = await this.routes.byId(routeId);
    const started = route.start(this.now());
    await this.routes.save(route, started);
  }
}
