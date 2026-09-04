# Session

*Generated from the portolan catalog · commit `5 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `auth.auth.session`
- **Service:** [Authentication & Sessions](../README.md)
- **Root:** `Session`

Proof that a user logged in, how long that proof is good for, and whether it
has been taken away. A separate aggregate from `User`: it is written far more
often and revoked without the user changing, so the two do not share a lock.
They are linked by user id and nothing else.

## States

- **Live** — issued, not revoked, not past expiry. The only state a token is
  accepted in.
- **Revoked** — ended by a command, with a reason. Terminal: a revoked session
  never comes back, logging in again produces a new one.
- **Expired** — past `ExpiresAt`. Derived from time when the token is
  presented; no command, no event, nothing runs. Every consumer already knows
  the expiry from `SessionStarted`.

The state is not stored as a field. It is read off `RevokedAt` and
`ExpiresAt` with `now`, so there is no second copy to drift. The moves are
one table, `Rules` in `rules.go`, run through `go-sdk/fsm` by `trigger`; a
command that would move the session somewhere the table does not allow is
refused there, which is what makes `Revoke` idempotent. Expiry is not in the
table: it is not a move, nothing runs when it happens.

```mermaid
stateDiagram-v2
    [*] --> Live : Start / SessionStarted
    Live --> Revoked : Revoke(reason) / SessionEnded
    Live --> Expired : now ≥ ExpiresAt (no event)
    Revoked --> [*]
    Expired --> [*]
```

## Commands

| Command | From | To | Event |
|---|---|---|---|
| `Start` | — | Live | `SessionStarted` |
| `Revoke(reason)` | Live | Revoked | `SessionEnded` |
| `Revoke(reason)` | Revoked, Expired | unchanged | none; reports "nothing to do" |

`Validate(now)` is the read: it says which state forbids use (`ErrRevoked`,
`ErrExpired`) or nothing. `Live(now)` is the same question as a boolean.

Revoking twice is the "nothing to do" answer, not a refusal: the caller asked
for something already true. Ending it again would publish a `SessionEnded`
for an ending that did not happen.

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

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> live
    live --> revoked: Revoke · SessionEnded
    revoked --> [*]
```

| From | To | On | Emits | Source |
| --- | --- | --- | --- | --- |
| `live` | `revoked` | `Revoke` | `SessionEnded` | `examples/auth/internal/domain/session/session.go:88` |

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

On the wire as `auth.SessionEnded`, on `auth_session`.

#### v1 — current

SessionEnded is published when a session is deliberately ended.

Source: `examples/auth/internal/domain/session/event/session_ended.go`

| Field | Type |
| --- | --- |
| `sessionID` | `string` |
| `userID` | `string` |
| `reason` | `Reason` |
| `occurredAt` | `time.Time` |

### SessionStarted

`auth.auth.session.SessionStarted`

On the wire as `auth.SessionStarted`, on `auth_session`.

#### v1 — current

SessionStarted is published on a successful login. ExpiresAt is on the event so a consumer can reason about the session's lifetime without asking auth again on every check.

Source: `examples/auth/internal/domain/session/event/session_started.go`

| Field | Type |
| --- | --- |
| `sessionID` | `string` |
| `userID` | `string` |
| `expiresAt` | `time.Time` |
| `occurredAt` | `time.Time` |
