# Authentication & Sessions

*Generated from the portolan catalog · commit `12 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `auth.auth`
- **Context:** [Authentication](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`examples/auth/`](https://github.com/shortlink-org/portolan/tree/main/examples/auth)
- **Owners:** `@shortlink-org/identity`

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

- [auth.0001](../../adr/auth.0001.md) — Aggregates return their events; they do not buffer them
- [auth.0002](../../adr/auth.0002.md) — Session is its own aggregate, linked to User by id
- [auth.0003](../../adr/auth.0003.md) — Session expiry publishes no event
- [auth.0004](../../adr/auth.0004.md) — Lockout is its own aggregate, keyed by user id
- [auth.0005](../../adr/auth.0005.md) — Validation lives in constructors, as specifications, and applies when a value is made
- [auth.0006](../../adr/auth.0006.md) — A password change ends sessions through a policy, and the domains never import each other
- [auth.0007](../../adr/auth.0007.md) — Login asks a risk service, and a blocked attempt is treated as a compromise
- [auth.0008](../../adr/auth.0008.md) — A cache in front of the token lookup, and nothing else
- [auth.0009](../../adr/auth.0009.md) — A locked account answers exactly like a wrong password
- [auth.0010](../../adr/auth.0010.md) — A revocation is written to the cache, not only dropped from it
- [auth.0011](../../adr/auth.0011.md) — The relay reads every topic and hands it to a bus; policies subscribe to the bus
- [auth.0012](../../adr/auth.0012.md) — Feature slices own their layers and local assembly
- [auth.0013](../../adr/auth.0013.md) — Domain events become integration events at the transactional outbox boundary
- [auth.0014](../../adr/auth.0014.md) — Session tokens are opaque, stored, revocable, and expire after 24 hours
- [auth.0015](../../adr/auth.0015.md) — Errors are owned by their layer and classified at the edge
- [auth.0016](../../adr/auth.0016.md) — Password cryptography is an application port

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

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Lockout](aggregates/lockout.md) | `Lockout` | 2 commands | 1 query | 1 event |
| [Session](aggregates/session.md) | `Session` | 3 commands | 1 query | 2 events |
| [User](aggregates/user.md) | `User` | 2 commands | 2 queries | 2 events |

## Provides

### auth.v1.Sessions

- **Source:** [`examples/auth/internal/transport/http/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/transport/http/gen/openapi.yaml)

| Method | Route | Request | Response |
| --- | --- | --- | --- |
| `login` | `POST /v1/sessions` | `LoginRequest` | `Session` |
| `logout` | `DELETE /v1/sessions/current` | — | `204` |
| `validateSession` | `GET /v1/sessions/current` | — | `SessionInfo` |

<a id="message-error"></a>
<details><summary>Error</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `message` | `string` | One sentence, always present. A client that shows the user a single line shows this one. |
| `reasons` | `[]string` | Optional. One entry per rule the request broke, present only where rules apply - a 404 or a 500 has none. Each entry names its own field, so it can be shown on its own without knowing what it referred to. |

</details>

<a id="message-loginrequest"></a>
<details><summary>LoginRequest</summary>

| Field | Type |
| --- | --- |
| `email` | `string (email)` |
| `password` | `string (password)` |

</details>

<a id="message-session"></a>
<details><summary>Session</summary>

| Field | Type |
| --- | --- |
| `token` | `string` |
| `expiresAt` | `string (date-time)` |

</details>

<a id="message-sessioninfo"></a>
<details><summary>SessionInfo</summary>

| Field | Type |
| --- | --- |
| `userId` | `string` |
| `expiresAt` | `string (date-time)` |

</details>

### auth.v1.Users

- **Source:** [`examples/auth/internal/transport/http/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/transport/http/gen/openapi.yaml)

| Method | Route | Request | Response |
| --- | --- | --- | --- |
| `changePassword` | `POST /v1/users/me/password` | `ChangePasswordRequest` | `204` |
| `getUser` | `GET /v1/users/{userId}` | — | `User` |
| `registerUser` | `POST /v1/users` | `RegisterRequest` | `User` |

<a id="message-changepasswordrequest"></a>
<details><summary>ChangePasswordRequest</summary>

| Field | Type |
| --- | --- |
| `currentPassword` | `string (password)` |
| `newPassword` | `string (password)` |

</details>

<a id="message-error"></a>
<details><summary>Error</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `message` | `string` | One sentence, always present. A client that shows the user a single line shows this one. |
| `reasons` | `[]string` | Optional. One entry per rule the request broke, present only where rules apply - a 404 or a 500 has none. Each entry names its own field, so it can be shown on its own without knowing what it referred to. |

</details>

<a id="message-registerrequest"></a>
<details><summary>RegisterRequest</summary>

| Field | Type |
| --- | --- |
| `email` | `string (email)` |
| `password` | `string (password)` |

</details>

<a id="message-user"></a>
<details><summary>User</summary>

| Field | Type |
| --- | --- |
| `userId` | `string` |
| `email` | `string (email)` |
| `createdAt` | `string (date-time)` |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `risk.v1.RiskService/Assess` | `risk.v1` | unresolved | [`examples/auth/internal/session/infrastructure/risk/gen/riskpb/risk_grpc.pb.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/risk/gen/riskpb/risk_grpc.pb.go) |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [`AccountLocked`](aggregates/lockout.md#event-auth-auth-lockout-accountlocked) | v1 | — |
| [`SessionEnded`](aggregates/session.md#event-auth-auth-session-sessionended) | v1 | — |
| [`SessionStarted`](aggregates/session.md#event-auth-auth-session-sessionstarted) | v1 | — |
| [`PasswordChanged`](aggregates/user.md#event-auth-auth-user-passwordchanged) | v1 | [auth.auth](README.md) |
| [`UserRegistered`](aggregates/user.md#event-auth-auth-user-userregistered) | v1 | — |

## Stores

| Store | Kind | Access | Schema |
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
| [auth.0012](../../adr/auth.0012.md) | Feature slices own their layers and local assembly | accepted | 2026-09-07 |
| [auth.0013](../../adr/auth.0013.md) | Domain events become integration events at the transactional outbox boundary | accepted | 2026-09-07 |
| [auth.0014](../../adr/auth.0014.md) | Session tokens are opaque, stored, revocable, and expire after 24 hours | accepted | 2026-09-07 |
| [auth.0015](../../adr/auth.0015.md) | Errors are owned by their layer and classified at the edge | accepted | 2026-09-07 |
| [auth.0016](../../adr/auth.0016.md) | Password cryptography is an application port | accepted | 2026-09-07 |
