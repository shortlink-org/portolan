import { injectable } from "inversify";
import type { Sessions } from "../../application/basket/usecases/checkout/usecase.ts";

/** Sessions with no auth to ask: every bearer is its own user id. */
@injectable()
export class PermissiveSessions implements Sessions {
  async validate(token: string): Promise<{ userId: string } | null> {
    return token ? { userId: token } : null;
  }
}
