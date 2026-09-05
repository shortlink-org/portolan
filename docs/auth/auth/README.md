# Authentication & Sessions

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `auth.auth`
- **Context:** [Authentication](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/auth`

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

## Running it

```bash
docker compose up -d
STORE_TYPE=postgres \
STORE_POSTGRES_URI=postgres://auth:auth@localhost:5432/auth?sslmode=disable \
  go run ./cmd/auth
```

`CACHE_TYPE=redis` with `STORE_REDIS_URI` turns the cache on; `RISK_ADDR`
points login at a risk service; `TRACER_URI` switches tracing on. Unset, each
is a stand-in that keeps nothing, allows everything, or costs nothing. The
schema is brought up to date at startup. `go test ./...` runs everything;
without Docker the packages that need Postgres or redis are skipped.
`go generate ./...` regenerates the server from the spec and the wire graph.

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Lockout](aggregates/lockout.md) | `Lockout` | 2 commands | 1 query | 1 event |
| [Session](aggregates/session.md) | `Session` | 3 commands | 1 query | 2 events |
| [User](aggregates/user.md) | `User` | 2 commands | 2 queries | 2 events |

## Provides

**`auth.v1.Users`** — `examples/auth/internal/infrastructure/transport/http/gen/openapi.yaml`

- `registerUser`
- `getUser`
- `changePassword`

<details><summary>RegisterRequest</summary>

| Field | Type |
| --- | --- |
| `email` | `string (email)` |
| `password` | `string (password)` |

</details>

<details><summary>User</summary>

| Field | Type |
| --- | --- |
| `userId` | `string` |
| `email` | `string (email)` |
| `createdAt` | `string (date-time)` |

</details>

<details><summary>Error</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `message` | `string` | One sentence, always present. A client that shows the user a single line shows this one. |
| `reasons` | `[]string` | Optional. One entry per rule the request broke, present only where rules apply - a 404 or a 500 has none. Each entry names its own field, so it can be shown on its own without knowing what it referred to. |

</details>

<details><summary>ChangePasswordRequest</summary>

| Field | Type |
| --- | --- |
| `currentPassword` | `string (password)` |
| `newPassword` | `string (password)` |

</details>

**`auth.v1.Sessions`** — `examples/auth/internal/infrastructure/transport/http/gen/openapi.yaml`

- `login`
- `validateSession`
- `logout`

<details><summary>LoginRequest</summary>

| Field | Type |
| --- | --- |
| `email` | `string (email)` |
| `password` | `string (password)` |

</details>

<details><summary>Session</summary>

| Field | Type |
| --- | --- |
| `token` | `string` |
| `expiresAt` | `string (date-time)` |

</details>

<details><summary>Error</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `message` | `string` | One sentence, always present. A client that shows the user a single line shows this one. |
| `reasons` | `[]string` | Optional. One entry per rule the request broke, present only where rules apply - a 404 or a 500 has none. Each entry names its own field, so it can be shown on its own without knowing what it referred to. |

</details>

<details><summary>SessionInfo</summary>

| Field | Type |
| --- | --- |
| `userId` | `string` |
| `expiresAt` | `string (date-time)` |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `risk.v1.RiskService/Assess` | `risk.v1` | unresolved | `examples/auth/internal/infrastructure/risk/gen/riskpb/risk_grpc.pb.go` |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [AccountLocked](aggregates/lockout.md) | v1 | — |
| [SessionEnded](aggregates/session.md) | v1 | — |
| [SessionStarted](aggregates/session.md) | v1 | — |
| [PasswordChanged](aggregates/user.md) | v1 | [auth.auth](README.md) |
| [UserRegistered](aggregates/user.md) | v1 | — |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Auth database](stores/pg.md) | postgres | owns | 3 tables |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [auth.0001](../../adr/auth.0001.md) | Aggregates return their events; they do not buffer them | accepted | 2026-08-20 |
| [auth.0002](../../adr/auth.0002.md) | Session is its own aggregate, linked to User by id | accepted | 2026-08-20 |
| [auth.0003](../../adr/auth.0003.md) | Session expiry publishes no event | accepted | 2026-08-22 |
| [auth.0004](../../adr/auth.0004.md) | Lockout is its own aggregate, keyed by user id | accepted | 2026-09-04 |
| [auth.0005](../../adr/auth.0005.md) | Validation lives in constructors, as specifications, and applies when a value is made | accepted | 2026-08-22 |
| [auth.0006](../../adr/auth.0006.md) | A password change ends sessions through a policy, and the domains never import each other | accepted | 2026-08-22 |
| [auth.0007](../../adr/auth.0007.md) | Login asks a risk service, and a blocked attempt is treated as a compromise | accepted | 2026-09-04 |
| [auth.0008](../../adr/auth.0008.md) | A cache in front of the token lookup, and nothing else | accepted | 2026-09-01 |
| [auth.0009](../../adr/auth.0009.md) | A locked account answers exactly like a wrong password | accepted | 2026-09-04 |
| [auth.0010](../../adr/auth.0010.md) | A revocation is written to the cache, not only dropped from it | accepted | 2026-09-05 |
| [auth.0011](../../adr/auth.0011.md) | The relay reads every topic and hands it to a bus; policies subscribe to the bus | accepted | 2026-09-05 |
