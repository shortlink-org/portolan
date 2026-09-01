# Session

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `auth.auth.session`
- **Service:** [Authentication & Sessions](../README.md)
- **Root:** `Session`

Holds the Session aggregate: proof that a user logged in,
how long that proof is good for, and whether it has been taken away.

It is a separate aggregate from User on purpose. A session is written far
more often than a user, and it is revoked without the user changing at all,
so the two do not belong under one lock. They are linked by UserID only.

## Entities

### Session — aggregate root

Session is the aggregate root. Its identity is ID; the Token is a secret it carries, not what it is called.

| Field | Type | Doc |
| --- | --- | --- |
| `ID` | `string` | — |
| `UserID` | `string` | — |
| `Token` | `token.Token` | — |
| `IssuedAt` | `time.Time` | — |
| `ExpiresAt` | `time.Time` | — |
| `RevokedAt` | `time.Time` | zero while live |
| `Version` | `int64` | Version is what the store compares against before writing; see the note on user.User.Version. Zero means the session has never been stored. |

## Value objects

### Token

Token is the opaque string a client presents instead of a password.

| Field | Type |
| --- | --- |
| `value` | `string` |

## Operations

| Operation | Kind | Exposed by | Doc |
| --- | --- | --- | --- |
| `EndAfterCredentialChange` | command | *internal* | Ends the sessions a credential change invalidates. |
| `Login` | command | `login` | Turns credentials into a session. |
| `Logout` | command | `logout` | Ends the session behind a token. |
| `Validate` | query | `changePassword`, `validateSession` | Resolves a token to a live session: who is calling, and how long the answer stays good. |

## Events

### SessionEnded

`auth.auth.session.SessionEnded`

#### v1 — current

SessionEnded is published when a session is deliberately ended.

Published on the bus as `auth.SessionEnded`.

Source: `examples/auth/internal/domain/session/event/session_ended.go`

| Field | Type |
| --- | --- |
| `sessionID` | `string` |
| `userID` | `string` |
| `reason` | `Reason` |
| `occurredAt` | `time.Time` |

### SessionStarted

`auth.auth.session.SessionStarted`

#### v1 — current

SessionStarted is published on a successful login. ExpiresAt is on the event so a consumer can reason about the session's lifetime without asking auth again on every check.

Published on the bus as `auth.SessionStarted`.

Source: `examples/auth/internal/domain/session/event/session_started.go`

| Field | Type |
| --- | --- |
| `sessionID` | `string` |
| `userID` | `string` |
| `expiresAt` | `time.Time` |
| `occurredAt` | `time.Time` |
