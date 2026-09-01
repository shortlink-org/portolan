# User

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `auth.auth.user`
- **Service:** [Authentication & Sessions](../README.md)
- **Root:** `User`

Holds the User aggregate: a person, the address they log in
with, and the hash of the password they log in by.

The aggregate is the transactional boundary. Every rule below is enforced
here and nowhere else, so a caller cannot reach past the root and leave a
User in a state the domain says is impossible.

## Entities

### User — aggregate root

User is the aggregate root. Identity is ID, minted once at registration and never reused - not the email, because people change addresses.

| Field | Type | Doc |
| --- | --- | --- |
| `ID` | `string` | — |
| `Email` | `email.Address` | — |
| `Password` | `password.Hash` | — |
| `CreatedAt` | `time.Time` | — |
| `Version` | `int64` | Version is what the store compares against before writing. It is carried on the aggregate rather than known only to the repository so that a copy which has gone stale can say so - without it, two changes made from two reads both succeed and the first one silently disappears. |

## Value objects

### email.Address

Address is a normalised email address.

| Field | Type |
| --- | --- |
| `value` | `string` |

### password.Hash

Hash is what the user domain stores in place of a password. The plaintext never lives on an aggregate and never leaves the function that hashed it.

| Field | Type |
| --- | --- |
| `algorithm` | `string` |
| `iterations` | `int` |
| `salt` | `[]byte` |
| `digest` | `[]byte` |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `Authenticate` | query | Checks an address and a password, and says which user they belong to. |
| `ChangePassword` | command | Replaces the password of a user, given the current one. |
| `Get` | query | Reads a user by id. |
| `Register` | command | Creates a user from an email address and a password. |

## Events

### PasswordChanged

`auth.auth.user.PasswordChanged`

#### v1 — current

PasswordChanged is published when a user's password is replaced. It says the password is different now; it does not carry the password, old or new, in any form.

Published on the bus as `auth.PasswordChanged`.

Source: `examples/auth/internal/domain/user/event/password_changed.go`

| Field | Type |
| --- | --- |
| `userID` | `string` |
| `by` | `string` |
| `occurredAt` | `time.Time` |

### UserRegistered

`auth.auth.user.UserRegistered`

#### v1 — current

UserRegistered is published once per user, at registration. It carries the address because consumers routinely need to reach the person, and asking auth for it on every event would make the bus useless.

Published on the bus as `auth.UserRegistered`.

Source: `examples/auth/internal/domain/user/event/user_registered.go`

| Field | Type |
| --- | --- |
| `userID` | `string` |
| `email` | `string` |
| `occurredAt` | `time.Time` |
