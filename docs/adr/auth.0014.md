# auth.0014 — Session tokens are opaque, stored, revocable, and expire after 24 hours

*Generated from the portolan catalog · commit `12 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-07
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** [`examples/auth/docs/adr/0014-session-token-lifecycle.md`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/docs/adr/0014-session-token-lifecycle.md)
- **Committed:** Victor Login, 2026-09-07 (`34b9b7c`)

### Context and Problem Statement

The refactor needs an explicit token lifecycle so structural changes do not
quietly introduce JWT claims, refresh tokens, rotation, or different expiry
and revocation behaviour.

### Decision Outcome

A successful login creates one session with one cryptographically random
32-byte token encoded as unpadded base64url. The token is opaque and carries no
claims. It is stored in the current persistence shape and looked up server-side;
an optional cache accelerates only `ByToken`.

The session is valid when it exists, has not been revoked, and `now` is before
`ExpiresAt`. Its fixed TTL remains 24 hours. Logout and security policies revoke
it irreversibly and emit `SessionEnded`; login creates a new session rather than
reviving or rotating one. Expiry is derived from time and emits no event. There
is no refresh token or refresh endpoint.

Malformed, unknown, expired, and revoked tokens all produce the same external
401 response. Internally they remain distinct errors for diagnosis and tests.

#### Consequences

- Good: revocation takes effect through server-side state and cached tombstones.
- Good: tokens reveal no identity or authorization data.
- Bad: validation requires a cache or database lookup.
- Deferred: hashing tokens at rest can be a separate migration; doing it in an
  architecture-only refactor would change persistence and operational recovery.
