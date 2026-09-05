// Sessions over auth's HTTP API. This is the one package that knows both the
// port the resolvers declare and the client auth's contract generates; the
// translation between them lives here rather than in either.
import createClient, { type Client } from "openapi-fetch";
import type { Session, Sessions } from "../../ports/sessions.ts";
import { PeerError } from "../errors.ts";
import type { paths } from "./gen/types.ts";

export class AuthSessions implements Sessions {
  private readonly client: Client<paths>;

  constructor(baseUrl: string) {
    this.client = createClient<paths>({ baseUrl });
  }

  async current(bearer: string): Promise<Session | null> {
    if (!bearer) return null;
    const { data, response } = await this.client.GET("/v1/sessions/current", {
      params: { header: { Authorization: `Bearer ${bearer}` } },
    });
    if (response.status === 401) return null;
    if (!data) throw new PeerError("auth", `answered ${response.status}`);

    return { userId: data.userId, expiresAt: data.expiresAt };
  }
}
