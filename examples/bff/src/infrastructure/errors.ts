/**
 * A peer did not answer, or answered with something nobody can act on.
 *
 * Not the customer's fault and not the storefront's, and the one error the
 * transport turns into a 502 rather than a field error. Nothing else in this
 * service throws: a refusal belongs to the service that made it.
 */
export class PeerError extends Error {
  constructor(readonly peer: string, message: string) {
    super(`${peer}: ${message}`);
  }
}
