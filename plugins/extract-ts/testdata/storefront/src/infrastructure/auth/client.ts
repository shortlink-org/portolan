import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./gen/types.ts";
import type { Sessions } from "../../ports/sessions.ts";

/** Sessions over auth's HTTP API. */
export class AuthSessions implements Sessions {
  private readonly client: Client<paths>;
  constructor(baseUrl: string) {
    this.client = createClient<paths>({ baseUrl });
  }

  async current(bearer: string): Promise<{ userId: string } | null> {
    const { data, response } = await this.client.GET("/v1/sessions/current", { headers: { Authorization: `Bearer ${bearer}` } });
    if (response.status !== 200 || !data) return null;
    return { userId: data.userId };
  }
}
