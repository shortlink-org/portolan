---
name: ddd-security
description: Apply the security rules a service built in layers must keep — indistinguishable refusals, secrets that never leave their value object, opaque tokens, what to do when an attempt is judged hostile. Use when handling credentials or tokens, choosing a refusal's status or message, deciding what an event or a response may carry, or reviewing a change to any authenticated path, in any language.
---

# Security

Every rule here exists because the alternative tells an attacker something,
or leaves them holding something. Each is placed in the layer that can
enforce it and nowhere else has to remember it.

## Rules

**Refusals that must be indistinguishable are one answer at every layer.**
Wrong password and unknown address are one domain error, passed through
every port untouched, and one 401 with one message at the edge. Change
password refuses a wrong current password with exactly the answer a failed
login gets, so it is not a cheaper way to test guesses than the front door.
No such token and expired token are one 401.

**A blocked attempt is not a 403.** A 403 says the account exists and is
worth attacking, which is the one thing the attacker came to learn. It is
the same 401 as a wrong password.

**A blocked attempt means the account is compromised.** Whoever is trying
has the right password. Every live session of the account is ended, with a
reason that says why, before the refusal goes back. Refusing alone would
leave the attacker's earlier session live.

**The plaintext never lives on an aggregate and never leaves the function
that hashed it.** The aggregate stores a hash value object; the hash stores
its algorithm and cost beside the digest so raising the cost keeps old ones
verifiable.

**Comparison of a secret is constant-time.** A timing difference tells an
attacker how much of a guess was right.

**The current password is required to change it, even from a valid
session.** Without it a stolen token is a stolen account.

**The creation policy is not applied when a secret is checked.** Raising the
minimum must not lock out everyone who registered under the old one.

**A token is opaque.** It carries no claims, so nothing outside its domain
can read anything out of it, and revoking it is a fact in the store rather
than a signature waiting to expire. Its `String()` is the storage encoding,
never a display form.

**Events carry no secrets, in any form.** `PasswordChanged` says the password
is different; it carries no password, old or new, and no hash.

**Responses carry nothing a client could build on by mistake.** The session
id is a row in this service's store and is not in the login answer.

**Unknown tokens are not cached.** Otherwise whoever sends made-up tokens
decides what the cache holds.

**A malformed credential is an unknown credential.** A header that is not a
bearer yields the empty string and gets the answer an unknown token gets,
not a 400 that says "almost".

**A 500 leaks nothing.** The detail stays on this side; the caller gets a
code and a fixed message.

**Recorded telemetry is scrubbed.** Database spans carry query parameters,
and for an auth service those are emails, hashes and tokens. What is
committed has them removed.

**Deliberate omissions are written down.** No MFA, no lockout, no refresh
tokens: each is a real requirement somewhere, and the README says it is not
here, so nobody assumes it is.

## Where each rule is enforced

| Rule | Layer |
|---|---|
| one error for wrong password / unknown address | aggregate |
| constant-time compare, hash parameters stored | value object |
| current password on change; policy on create only | aggregate + value object |
| pass-through of refusals | use case, assembly adapter |
| end sessions on block, then refuse | use case |
| no secrets in events | event constructors |
| one 401, no 403, 500 without detail | transport |
| no caching of misses; key prefix | cache adapter |

## Checklist

- Every refusal on an authenticated path: same code, same message as its siblings.
- No plaintext on a struct, in a log, in an event, in a span.
- Constant-time compare on every secret.
- Block path ends sessions before refusing.
- README lists what is deliberately not implemented.
