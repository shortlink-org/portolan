import type { RouteRepository } from "../../../../domain/route/port.ts";

/** Ends the day, whatever is left undone. */
export class UseCase {
  constructor(private readonly routes: RouteRepository) {}

  async handle(routeId: string): Promise<void> {
    const route = await this.routes.byId(routeId);
    route.close();
    await this.routes.save(route);
  }
}
