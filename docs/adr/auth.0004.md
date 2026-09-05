# auth.0004 — Lockout is its own aggregate, keyed by user id

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0004-lockout-is-its-own-aggregate.md`

### Context and Problem Statement

Five wrong passwords in a row should lock an account for a while. Where does
the count live, and what is it counted against?

The obvious answer is two columns on the user: a counter and a locked-until.
It is also the answer that writes the user row on every wrong password typed
by anybody who knows the address.

### Decision Drivers

- A wrong password must not contend with a real change to the user.
- Nobody must be able to lock somebody else by typing their address.
- The answer outside must not change: one refusal, whatever the reason.
- A lock must end by itself; nothing should have to run to end it.

### Considered Options

1. **A separate `Lockout` aggregate**, one row per user id, created on the
   first wrong password, in its own table.
2. **Two columns on `User`**: `failures` and `locked_until`, written by
   `Authenticate`.
3. **Counting by address or client** in a store keyed by what was typed, so
   that unknown addresses count too.

### Decision Outcome

Chosen option: **a separate aggregate, keyed by user id**.

| | contention with the user row | can lock somebody else | leaks that an address exists |
|---|---|---|---|
| separate aggregate by user id | none | no: no account, no count | no: same refusal |
| columns on User | every guess bumps the user's version | no | no |
| by address | none | yes: type their address with junk | no, but a stranger can lock the owner out |

Option 2 is a third less code and breaks the rule every other aggregate here
follows: what changes at a different rate is a different aggregate. A
concurrent password change would fail on a stranger's typo. Option 3 counts
the wrong thing: the account is what is being guessed at, and letting an
unknown address accumulate anything lets anybody deny anybody.

The price of option 1 is a port. `authenticate` in the user domain has to
ask the lockout and tell it how the check went, and neither domain may
import the other; so `authenticate` declares a three-method interface and
assembly adapts the lockout's use cases to it, the same shape as `login`'s
`Authenticator`.

#### Consequences

- Good: the users table is written only when the user changes.
- Good: a lock is invisible from outside; the refusal is the same 401.
- Good: the lock ends by time, like session expiry, with no sweep and no
  event for it (auth.0003).
- Bad: one more read on every login, and a write on every wrong password.
  The read is by primary key; the write is the point.
- Bad: a lockout store that is unreachable stops the credential check with
  an error rather than letting it through. Letting it through would turn
  the store being down into unlimited guessing, silently.
- Neutral: sessions are untouched by a lock. A risk block ends them because
  the attempt had the right password; a lockout means it did not.
