# Authentication & Sessions

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

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

## Running it

```bash
docker compose up -d
STORE_TYPE=postgres \
STORE_POSTGRES_URI=postgres://auth:auth@localhost:5432/auth?sslmode=disable \
  go run ./cmd/auth
```

The schema is brought up to date at startup. Each aggregate owns its own
migrations and its own `schema_migrations_*` table, numbered from 1 within its
own package: `user` and `session` both have an `0001`, and neither waits for the
other, because no table here refers to one in another aggregate.

Tests start their own database through testcontainers, so a run cannot be
affected by whatever state a local one is in. Without Docker the packages that
need one are skipped and the domain tests - the majority, and the ones worth
having - still run.

Regenerating after a change to the spec or the wire graph:

```bash
go generate ./...
```

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
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

## Publishes

| Event | Latest |
| --- | --- |
| [SessionEnded](aggregates/session.md) | v1 |
| [SessionStarted](aggregates/session.md) | v1 |
| [PasswordChanged](aggregates/user.md) | v1 |
| [UserRegistered](aggregates/user.md) | v1 |
