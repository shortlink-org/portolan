# auth.0009 — A locked account answers exactly like a wrong password

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0009-a-lock-answers-like-a-wrong-password.md`

### Context and Problem Statement

Once an account is locked (auth.0004), what does a login attempt get back, and
what counts towards the lock?

### Decision Outcome

While locked, a password is refused *unchecked*, with exactly the answer a
wrong one gets, so a lock discloses nothing a wrong password would not. The
count is per account: an unknown address is refused before anything is
counted, so guessing at addresses locks nobody, and nobody can lock somebody
else by typing their address with junk. The lock ends by time and nothing runs
when it does; the next wrong password starts the count at one, and a right one
clears it.

A lock does not end the account's sessions. Unlike a risk block (auth.0007) it
means somebody has *not* got the password, and the sessions are the owner's.

#### Consequences

- Good: an attacker cannot tell a locked account from a wrong guess, and
  cannot lock an account they do not know the address of.
- Bad: the owner cannot tell either; the storefront has to say "try again
  later" on every refusal, and support has no way to lift a lock early.
