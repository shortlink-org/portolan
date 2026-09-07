# Authentication & Sessions

Service `auth` — bounded context **auth**.

Owns *who someone is* and *whether they are still logged in*. It is the only
service in the estate that stores credentials, and the only one allowed to mint
or revoke a session.

## What it does

- Registers a user: an email address and a password, hashed before it is stored.
- Authenticates: checks a password and answers with a user id or a refusal.
- Replaces a password, given the current one, and ends the sessions the old one
  was issued against.
- Starts a session on a successful login, once a risk service has allowed it,
  and hands back an opaque token.
- Ends a session on logout.
- Validates a token for everyone else — the hot path every authenticated
  request in `shop` goes through.
- Locks an account after five wrong passwords in a row, for fifteen minutes,
  and says so with an event.

## Structure

The service is split vertically by capability. `user`, `session`, and
`lockout` each own their domain, use cases, adapters, integration-event DTOs,
and a local Wire set. Cross-module policies live with the module whose state
they change; the password-change policy therefore lives under `session`.

Shared runtime mechanics are deliberately outside the feature modules:

- `internal/platform` — unit of work, messaging and tracing adapters;
- `internal/transport/http` — the one generated OpenAPI server;
- `internal/di` — the service composition root and shared resources.

Test setup is not a shared package. Application and policy tests use
Mockery-generated mocks in their own package; Postgres and Redis containers
exist only beside the infrastructure, platform, or composition-root behaviour
they exercise.

Domain events are immutable in-process facts. Before they enter the outbox,
each module maps them to a public integration-event DTO. Aggregate storage and
the outbox append share one transaction through `platform/uow`.

## What it does not do

No profile data, no addresses, no payment instruments, no roles or scopes.
Other contexts hold their own view of a customer and reference it by opaque
user id; nothing outside `auth` ever sees a credential.

No MFA, no email verification, no refresh tokens, no way for support to lift a
lock early. Each of those is a real requirement somewhere, and none of them is
here: this service is deliberately the smallest thing that is still
authentication.

## Decisions

- [auth.0001](docs/adr/0001-events-returned-not-buffered.md) — Aggregates return their events; they do not buffer them
- [auth.0002](docs/adr/0002-session-is-its-own-aggregate.md) — Session is its own aggregate, linked to User by id
- [auth.0003](docs/adr/0003-expiry-publishes-nothing.md) — Session expiry publishes no event
- [auth.0004](docs/adr/0004-lockout-is-its-own-aggregate.md) — Lockout is its own aggregate, keyed by user id
- [auth.0005](docs/adr/0005-rules-are-specifications-at-construction.md) — Validation lives in constructors, as specifications, and applies when a value is made
- [auth.0006](docs/adr/0006-a-password-change-ends-sessions-through-a-policy.md) — A password change ends sessions through a policy, and the domains never import each other
- [auth.0007](docs/adr/0007-login-asks-risk-and-a-block-is-a-compromise.md) — Login asks a risk service, and a blocked attempt is treated as a compromise
- [auth.0008](docs/adr/0008-a-cache-in-front-of-bytoken-only.md) — A cache in front of the token lookup, and nothing else
- [auth.0009](docs/adr/0009-a-lock-answers-like-a-wrong-password.md) — A locked account answers exactly like a wrong password
- [auth.0010](docs/adr/0010-a-revocation-is-written-to-the-cache.md) — A revocation is written to the cache, not only dropped from it
- [auth.0011](docs/adr/0011-the-relay-feeds-a-bus-and-policies-subscribe-to-the-bus.md) — The relay reads every topic and hands it to a bus; policies subscribe to the bus
- [auth.0012](docs/adr/0012-feature-slices-own-their-layers.md) — Feature slices own their layers and local assembly
- [auth.0013](docs/adr/0013-domain-events-become-integration-events-at-the-outbox.md) — Domain events become integration events at the transactional outbox boundary
- [auth.0014](docs/adr/0014-session-token-lifecycle.md) — Session tokens are opaque, stored, revocable, and expire after 24 hours
- [auth.0015](docs/adr/0015-errors-are-owned-and-classified-at-the-edge.md) — Errors are owned by their layer and classified at the edge
- [auth.0016](docs/adr/0016-password-cryptography-is-an-application-port.md) — Password cryptography is an application port

## Running it

```bash
docker compose up -d
STORE_TYPE=postgres \
STORE_POSTGRES_URI=postgres://auth:auth@localhost:5432/auth?sslmode=disable \
  go run ./cmd/auth
```

`CACHE_TYPE=redis` with `STORE_REDIS_URI` turns the cache on. Risk is disabled
by default: `RISK_ENABLED=true` plus `RISK_ADDR=host:port` enables the gRPC
adapter; `RISK_ADDR` alone remains supported for compatibility. Disabled risk
uses the local permissive adapter, while enabled-but-unreachable risk fails
closed and issues no session. `TRACER_URI` switches tracing on.

The schema is brought up to date at startup. `go test ./...` runs everything;
without Docker the packages that need Postgres or Redis are skipped.
`go generate ./...` regenerates the server, Wire graph, and package-local test
mocks from each feature slice's `.mockery.yml`.
`golangci-lint run` also enforces module boundaries through its built-in
`depguard` linter and `.golangci.yml`; no custom linter binary is required.
