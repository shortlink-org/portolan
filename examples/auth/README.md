# Authentication & Sessions

Service `auth` — bounded context **auth**.

Owns *who someone is* and *whether they are still logged in*. It is the only
service in the estate that stores credentials, and the only one allowed to mint
or revoke a session.

## What it does

- Registers a user: an email address and a password, hashed before it is stored.
- Authenticates: checks a password and answers with a user id or a refusal.
- Replaces a password, given the current one.
- Starts a session on a successful login and hands back an opaque token.
- Ends a session on logout.
- Validates a token for everyone else — the hot path every authenticated
  request in `shop` goes through.

## What it does not do

No profile data, no addresses, no payment instruments, no roles or scopes.
Other contexts hold their own view of a customer and reference it by opaque
user id; nothing outside `auth` ever sees a credential.

No MFA, no email verification, no lockout after repeated failures, no refresh
tokens. Each of those is a real requirement somewhere, and none of them is here:
this service is deliberately the smallest thing that is still authentication.

## Domain

Two aggregates, linked by user id and nothing else. They are separate because a
session is written far more often than a user and is revoked without the user
changing at all, so the two do not belong under one lock.

| | Root | Value objects | Publishes |
|---|---|---|---|
| `user` | `User` — id, email, password hash | `email.Address`, `password.Hash` | `UserRegistered`, `PasswordChanged` |
| `session` | `Session` — id, user id, token, expiry, revocation | `token.Token` | `SessionStarted`, `SessionEnded` |

Aggregates return their events rather than buffering them, so what happened is
visible in the signature and publishing is the caller's business.

Both carry a version. A write is refused if the aggregate was changed since it
was read, so two changes made from one read cannot both succeed with the first
one silently disappearing.

Expiry publishes nothing. When a session runs out of time no code runs and
nobody decides anything, and every consumer already knows the expiry from
`SessionStarted`; an event there would be invented by whichever sweep noticed
first.

### Rules

Validation lives in the value object constructors, so a value that exists is a
value that passed. Each rule is a specification in a `rules/` package next to
the value object it governs, and the policy — which rules currently apply — is
the `composite.go` in that package.

- **email** — required, at most 254 characters, parsable by `net/mail`, and not
  in display form: `Ada <ada@example.com>` is an address but not a login.
- **password** — 8 to 32 characters, at least one digit, one lower-case and one
  upper-case letter, no whitespace.
- **token** — 32 random bytes, unpadded base64url.

The password policy applies when a password is *created*, never when one is
checked. Raising the minimum must not lock out everyone who registered under
the old one, whose stored hash is still perfectly good.

### The one rule that spans both

A password change ends the sessions issued against the old password. That rule
belongs to neither aggregate, so it is written into neither: the user aggregate
publishes `PasswordChanged`, and a policy in `internal/application/policy` hears
it and ends the sessions. `session` never imports `user`, `user` never imports
`session`.

What that means for a caller is in the use cases that carry it out - see
`internal/application/user/usecases/change_password`.

## HTTP

The API is `internal/infrastructure/transport/http/gen/openapi.yaml`. Routes,
shapes, status codes and the reasoning behind them are described there, and the
server interface is generated from it - so it is the one place that can be
wrong, and it cannot drift from this file because this file does not repeat it.

## Risk

Login asks a risk service before it issues anything. The contract is a narrowed
copy of `risk.v1` under `internal/infrastructure/risk/proto`, the generated
client beside it, and `RISK_ADDR` says where the service is; unset, every
attempt is allowed, so a laptop does not need one.

The use case does not know any of that. It declares `login.Risk` - an attempt
in, a verdict out - and assembly hands it the adapter in
`internal/infrastructure/risk`, which is the one package that speaks both. That
is the same shape as the Authenticator, and for the same reason: the knowledge
that another service exists lives in one place, and it is not the domain.

A blocked attempt is treated as the account being compromised. Whoever is
trying has the right password, so every live session the account has is ended
first - `SessionEnded` with reason `risk-blocked`, one transaction each - and
only then is the attempt refused, with the same 401 as a wrong password. A 403
would say the account exists and is worth attacking, which is the one thing
the attacker came to learn.

## Tracing

`TRACER_URI` names an OTLP collector and switches tracing on; without it the
provider is the no-op one and every span costs nothing. Requests are traced by
route, database calls by the SDK's pgx tracer, and each domain event twice:
where it is written to the outbox and where a policy takes it off the bus, with
the event's name on both spans and the trace carried across the table so the
two are one trace. `telemetry/` holds the collector config, a script that
records the service doing everything it does, and the recording itself, which
is what the catalog is verified against: see `telemetry/README.md`.

## Caching

`ByToken` is the hot path: every authenticated request in the estate ends
there, asking the same question about the same token over and over. It is the
one read in this service worth keeping an answer to, so there is a cache in
front of it.

The cache itself is `go-sdk/cache` — a byte-level port, its redis adapter and a
noop. This service has no adapter of its own and no redis client in its imports:
what lives here is `cached.go`, next to the store it decorates, and it decides
only what to keep, for how long, and when to forget it. That is the part which
is about sessions; opening a connection is not.

Nothing above infrastructure knows. `session.Repository` did not change, the use
cases did not change, and they could not have: they take the port and always
did. Assembly binds the port to `Cached` wrapping `Postgres` instead of to
`Postgres`, and that one function in `internal/di/provider/repository.go` is the
whole of the change. A cache is a fact about how fast a deployment has to be,
not a fact about what a session is, so the domain has no port for one.

Only `ByToken` is cached. `ByID` is read by the code that is about to write, and
`ByUserID` answers a question about a set — the kind of entry nothing can
invalidate honestly, because a session started for that user changes the answer
and the write that started it never knew the list existed.

What makes it safe to read a session from somewhere other than the database:

- **The version travels with it.** A cached copy is a copy taken at a version,
  and a write made from a stale one is refused rather than applied. Caching a
  read cannot cause a wrong write here, only a retried one.
- **Nothing is read from the cache inside a transaction.** A use case reading
  through it would be deciding on a copy its own transaction never saw and
  cannot have locked.
- **Revocation drops the entry** — before the write and again after it. The
  first drop is what survives a process dying after the commit; the second is
  what survives a reader repopulating the entry while the write was in flight.
- **An entry never outlives its session.** The TTL is the shorter of
  `CACHE_SESSION_TTL` and what is left of the session's own life. Expiry is the
  one way a session changes with nothing running to notice.
- **The key is a hash of the token, never the token.** The token is the
  credential itself, and a `KEYS` scan, a slow-log line or a redis dump is not
  treated like a password store.
- **A cache that is down is not an outage.** Every cache failure on the read
  path is swallowed and the database answers; a failed invalidation does not
  fail the write that already committed. What that costs is a stale entry for
  the rest of its TTL, which is what the TTL is for — a minute by default, and
  it is not how long a logout takes to be seen, it is how long the estate stays
  wrong when the invalidation is the thing that broke.

`STORE_REDIS_CLIENT_CACHE_TTL` additionally keeps a copy inside each process for
that long. It is off by default and safe to turn on: the SDK's local layer is
redis client-side caching, which the server invalidates on every replica when a
key changes. An in-process LRU could not be — nothing would tell it about a
logout, and every replica but the one that handled it would keep saying the
session is live.

## Running it

```bash
docker compose up -d
STORE_TYPE=postgres \
STORE_POSTGRES_URI=postgres://auth:auth@localhost:5432/auth?sslmode=disable \
  go run ./cmd/auth
```

With the cache:

```bash
docker compose up -d
STORE_TYPE=postgres \
STORE_POSTGRES_URI=postgres://auth:auth@localhost:5432/auth?sslmode=disable \
CACHE_TYPE=redis \
STORE_REDIS_URI=localhost:6379 \
  go run ./cmd/auth
```

`CACHE_TYPE` defaults to `none`, which wires a cache that keeps nothing and
misses every read — so the uncached path is a different cache rather than a
different code path, and it is the one that runs on a laptop. A `CACHE_TYPE`
nobody recognises fails at assembly: that is somebody asking for a cache and
getting silence.

The schema is brought up to date at startup. Each aggregate owns its own
migrations and its own `schema_migrations_*` table, numbered from 1 within its
own package: `user` and `session` both have an `0001`, and neither waits for the
other, because no table here refers to one in another aggregate.

Tests start their own database and their own redis through testcontainers, so a
run cannot be affected by whatever state a local one is in. Without Docker the
packages that need one are skipped and the domain tests - the majority, and the
ones worth having - still run. Most of the decorator's tests need neither: when
it asks the store and when it does not is a question a fake answers faster and
no less honestly. One test does use a real redis, and only for what a fake
cannot say - that a session survives the round trip through what is actually
stored, and that revoking one removes it from a server rather than from a map
that agrees with us.

Regenerating after a change to the spec or the wire graph:

```bash
go generate ./...
```
