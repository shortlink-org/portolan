import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./gen/types.ts";
import type { Sessions } from "../../application/basket/usecases/checkout/usecase.ts";

/** Sessions over auth's HTTP API. */
export class AuthSessions implements Sessions {
  private readonly client: Client<paths>;
  constructor(baseUrl: string) {
    this.client = createClient<paths>({ baseUrl });
  }

  async validate(token: string): Promise<{ userId: string } | null> {
    const { data, response } = await this.client.GET("/v1/sessions/current", { headers: { Authorization: `Bearer ${token}` } });
    if (response.status !== 200 || !data) return null;
    return { userId: data.userId };
  }
}
