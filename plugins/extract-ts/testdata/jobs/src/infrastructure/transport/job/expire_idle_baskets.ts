import { UseCase as ExpireIdleBaskets } from "../../../application/basket/usecases/expire_idle_baskets/usecase.ts";

/** The sweep, on the hour. */
export class ExpireIdleBasketsJob {
  readonly name = "expire-idle-baskets";
  readonly everyMs = 60 * 60 * 1000;

  constructor(private readonly expireIdleBaskets: ExpireIdleBaskets) {}

  async run(): Promise<void> {
    await this.expireIdleBaskets.handle();
  }
}

/** Named and running, but nothing the syntax says fires it: reported, and no flow. */
export class ReindexJob {
  readonly name = "reindex";
  readonly everyMs = Number(process.env.REINDEX_MS);

  async run(): Promise<void> {}
}
