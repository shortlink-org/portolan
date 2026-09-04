// Sessions over auth's HTTP API. This is the one package that knows both the
// port checkout declares and the client auth's contract generates; the
// translation between them lives here rather than in either.
import createClient, { type Client } from "openapi-fetch";
import { injectable } from "inversify";
import type { Sessions } from "../../application/basket/usecases/checkout/usecase.ts";
import type { paths } from "./gen/types.ts";

@injectable()
export class AuthSessions implements Sessions {
  private readonly client: Client<paths>;

  constructor(baseUrl: string) {
    this.client = createClient<paths>({ baseUrl });
  }

  async validate(bearer: string): Promise<{ userId: string } | null> {
    const { data, response } = await this.client.GET("/v1/sessions/current", {
      params: { header: { Authorization: `Bearer ${bearer}` } },
    });
    if (response.status === 401) return null;
    if (!data) throw new Error(`auth answered ${response.status}`);
    return { userId: data.userId };
  }
}

/** The stand-in assembly uses without AUTH_URL: every session is live (cart.0004). */
@injectable()
export class PermissiveSessions implements Sessions {
  async validate(bearer: string): Promise<{ userId: string } | null> {
    return bearer ? { userId: `visitor:${bearer.slice(0, 8)}` } : null;
  }
}
