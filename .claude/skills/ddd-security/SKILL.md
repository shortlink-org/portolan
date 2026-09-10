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
Credential checking maps wrong password and unknown address to one application
error. Cross-module adapters preserve that equivalence through their local
contracts, and the edge returns one 401 with one message. Change
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

**Plaintext never enters an aggregate or repository.** It is transient input
to an application operation and its cryptographic port. Following `auth.0016`,
the domain retains policy and an opaque hash; the infrastructure adapter owns
randomness, derivation, verification and stored algorithm/cost compatibility.

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

**Deliberate omissions are written down.** No MFA, no email verification, no refresh
tokens: each is a real requirement somewhere, and the README says it is not
here, so nobody assumes it is.

## Where each rule is enforced

| Rule | Layer |
|---|---|
| one error for wrong password / unknown address | credential-checking application use case |
| constant-time compare, hash parameters stored | cryptographic infrastructure adapter behind application ports |
| current password on change; policy on create only | application orchestration + domain policy |
| equivalent refusals under local contracts | application, consuming infrastructure adapter |
| end sessions on block, then refuse | use case |
| no secrets in events | event constructors |
| one 401, no 403, 500 without detail | transport |
| no caching of misses; key prefix | cache adapter |

## Checklist

- Every refusal on an authenticated path: same code, same message as its siblings.
- Plaintext only in transient request/application input and cryptographic calls; none in aggregate, repository, log, event or span.
- Constant-time compare on every secret.
- Block path ends sessions before refusing.
- README lists what is deliberately not implemented.

Current Go ownership: [references/go.md](references/go.md).
