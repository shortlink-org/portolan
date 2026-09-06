/** @typedef {import("../../application/basket/usecases/checkout/usecase.js").Sessions} Sessions */

/**
 * Sessions with no auth to ask: every bearer is its own user id.
 * @implements {Sessions}
 */
export class PermissiveSessions {
  /**
   * @param {string} token
   * @returns {Promise<{ userId: string } | null>}
   */
  async validate(token) {
    return token ? { userId: token } : null;
  }
}
