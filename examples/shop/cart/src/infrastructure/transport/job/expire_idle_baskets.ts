// The sweep's way in (cart.0006). Nobody outside calls abandonment: a clock
// does, and this is the edge it comes in on, the way a handler is the edge an
// HTTP call comes in on. It has a name and a schedule a reader can see, runs
// the one use case it is named for, and decides nothing itself.
import { inject, injectable } from "inversify";
import { UseCase as ExpireIdleBaskets } from "../../../application/basket/usecases/expire_idle_baskets/usecase.ts";
import type { Job } from "./scheduler.ts";

/** Abandons every open basket nobody touched for a day, and says so for each. */
@injectable()
export class ExpireIdleBasketsJob implements Job {
  readonly name = "expire-idle-baskets";
  /** Once a minute; what counts as idle is the use case's to say. */
  readonly everyMs = 60_000;

  constructor(@inject(ExpireIdleBaskets) private readonly expireIdleBasketsUseCase: ExpireIdleBaskets) {}

  async run(): Promise<void> {
    await this.expireIdleBasketsUseCase.handle();
  }
}
