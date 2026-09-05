// What the storefront needs from whoever knows who somebody is.
//
// A port, not a client: the resolvers say what they need, and assembly decides
// what fills it. Nothing here mentions auth, HTTP or a bearer scheme, and the
// shapes are the storefront's own - a peer's spelling stops at the adapter.
export interface Session {
  userId: string;
  expiresAt: string;
}

export interface Sessions {
  /** The session the token belongs to, or null when it belongs to none. */
  current(bearer: string): Promise<Session | null>;
}
