# auth.0002 — Session is its own aggregate, linked to User by id

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-08-20
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0002-session-is-its-own-aggregate.md`

### Context and Problem Statement

A session belongs to a user. Is it part of the `User` aggregate, a list of
sessions the user root owns, or an aggregate of its own?

### Decision Drivers

- A session is written on every login and every logout; a user is written
  on registration and password change.
- A session is revoked without the user changing at all.
- A user with many devices must not have every login serialised on one row.

### Considered Options

1. **Two aggregates**, linked by user id only. Neither imports the other.
2. **Sessions inside `User`**, as a collection the root guards.

### Decision Outcome

Chosen option: **two aggregates**.

| | one lock per change | version conflicts | rule across both |
|---|---|---|---|
| two aggregates | yes | on the row that changed | a policy on `PasswordChanged` |
| sessions inside user | no: every login bumps the user's version | every concurrent login on one account conflicts | free, inside the root |

The one rule that needs both, a password change ending sessions, is what
option 2 gets for free and option 1 has to write as a policy. That policy is
the price, and it is paid once, in one package that hangs off the fact rather
than the use case, so every way a password can change gets it.

#### Consequences

- Good: the session store is the hot path and never contends with the user
  row.
- Good: `session` never imports `user`; both domains can be read alone.
- Bad: the credential-change rule is eventually consistent. For a moment the
  other devices still work; `end_after_credential_change` says why that is
  correct rather than a bug.
- Neutral: login needs the user domain to vouch for a credential. It states
  that as a port, and assembly adapts the authenticate use case to it.
