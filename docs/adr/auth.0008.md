# auth.0008 — A cache in front of the token lookup, and nothing else

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-01
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0008-a-cache-in-front-of-bytoken-only.md`
- **Note:** how a revocation is kept out of the cache was decided again in auth.0010; the drop described below turned out not to be enough.

### Context and Problem Statement

`ByToken` is the hot path: every authenticated request in the estate ends
there, asking the same question about the same token over and over. Nothing
else in this service is read often enough to keep an answer to.

### Decision Outcome

A decorator over the session repository caches `ByToken` and only `ByToken`.
`ByID` is read by code about to write, and `ByUserID` answers a question about
a set, which nothing can invalidate honestly. Assembly binds the port to the
decorator wrapping the store; the domain and the use cases do not change,
because a cache is a fact about how fast a deployment has to be, not about
what a session is.

What makes reading a session from somewhere other than the database safe:
the version travels with the copy, so a write from a stale one is refused;
nothing is read from the cache inside a transaction; revocation drops the
entry before and after the write; an entry never outlives its session; the
key is a hash of the token, never the token; and a cache that is down is not
an outage - the database answers and a failed invalidation does not fail the
write that committed.

#### Consequences

- Good: the estate's hottest read costs one cache hit, and turning the cache
  off is a different adapter, not a different code path.
- Bad: a stale entry can outlive a logout by the rest of its TTL when the
  invalidation is the thing that broke; the TTL is how long the estate stays
  wrong then, and it is a minute.
