import type { Baskets } from "../../../ports/baskets.ts";
import type { Sessions } from "../../../ports/sessions.ts";

/** What every resolver is handed: the ports, and what the request carried. */
export interface GraphQLContext {
  sessions: Sessions;
  baskets: Baskets;
  bearer: string;
}
