import type { Sessions } from "../../application/basket/usecases/checkout/usecase.ts";
import { AuthSessions } from "../../infrastructure/auth/client.ts";

export function provideSessions(authUrl: string): Sessions {
  return new AuthSessions(authUrl);
}
