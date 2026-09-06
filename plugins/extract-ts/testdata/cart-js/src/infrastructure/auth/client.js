import createClient from "openapi-fetch";

/** @typedef {import("./gen/types.js").paths} paths */
/** @typedef {import("../../application/basket/usecases/checkout/usecase.js").Sessions} Sessions */

/**
 * Sessions over auth's HTTP API.
 * @implements {Sessions}
 */
export class AuthSessions {
  /** @param {string} baseUrl */
  constructor(baseUrl) {
    /** @type {import("openapi-fetch").Client<paths>} */
    this.client = createClient({ baseUrl });
  }

  /**
   * @param {string} token
   * @returns {Promise<{ userId: string } | null>}
   */
  async validate(token) {
    const { data, response } = await this.client.GET("/v1/sessions/current", { headers: { Authorization: `Bearer ${token}` } });
    if (response.status !== 200 || !data) return null;
    return { userId: data.userId };
  }
}
