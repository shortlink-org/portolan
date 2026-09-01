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

A password change ends the sessions issued against the old password - all of
them except the one the change was made from, so nobody is signed out of the
device in their hand.

That rule belongs to neither aggregate, so it is not written into either. The
user aggregate publishes `PasswordChanged`; a policy in
`internal/application/policy` hears it and ends the sessions. `session` never
imports `user`, `user` never imports `session`, and any other way a password
comes to change - a support reset, an import - gets the same behaviour without
asking for it.

Which sessions actually die is a decision, not a loop, so it is a domain service
in `internal/domain/session/services`: sessions started *after* the change
survive, because they were issued against the new password; already revoked or
expired ones are left alone, because ending them again would publish an event
that reports nothing.

The rule is eventually consistent by construction. The bus here is synchronous
and in-process, so the window is nil; behind a real broker it would not be, and
that is why the moment of the change travels on the event rather than being read
off the clock at the far end.

## HTTP

The API is `internal/infrastructure/transport/http/gen/openapi.yaml`. Routes,
shapes, status codes and the reasoning behind them are described there, and the
server interface is generated from it - so it is the one place that can be
wrong, and it cannot drift from this file because this file does not repeat it.

## Running it

```bash
AUTH_ADDR=:8080 go run ./cmd/auth
```

Storage is in memory, so a restart is a clean slate.

Regenerating after a change to the spec or the wire graph:

```bash
go generate ./...
```
