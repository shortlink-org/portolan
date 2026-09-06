import { AuthSessions } from "../../infrastructure/auth/client.js";

/** @typedef {import("../../application/basket/usecases/checkout/usecase.js").Sessions} Sessions */

/**
 * @param {string} authUrl
 * @returns {Sessions}
 */
export function provideSessions(authUrl) {
  return new AuthSessions(authUrl);
}
