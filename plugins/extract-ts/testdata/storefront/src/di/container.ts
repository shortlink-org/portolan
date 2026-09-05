import { AuthSessions } from "../infrastructure/auth/client.ts";
import type { Sessions } from "../ports/sessions.ts";

export function provideSessions(authUrl: string): Sessions {
  return new AuthSessions(authUrl);
}
