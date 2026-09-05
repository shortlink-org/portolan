# Glossary — Authentication

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Context:** [Authentication](README.md)
- **Terms:** 27
- **Read from:** `examples/auth/GLOSSARY.md`

One meaning per word inside this context, as the glossary beside the code states it.

## Terms

- **Attempt** — What the risk service is told about a login it is asked to judge: the user id, once the credentials have been checked.
- **Authenticate** — Check an email address and a password and answer with a user id or one refusal.
- **Bus** — What the relay hands an event to once it is out of the outbox, and what a policy subscribes to. One per domain, in-process today.
- **Conflict** — The copy of an aggregate in hand is not what is stored; somebody wrote it since it was read.
- **Credential** — An email address and a password, presented together.
- **Email address** — The address a user logs in with, normalised and validated on creation.
- **Expiry** — The moment a session stops being usable because of time.
- **Locked** — The state of a lockout while it refuses. Read off the time; nothing runs when it ends.
- **Lockout** — An account refusing passwords for a while after too many wrong ones in a row: five, for fifteen minutes. One per user, from the first wrong password on.
- **Login** — Turn a credential into a session: authenticate, ask risk, start.
- **Logout** — End the session behind a token, at the user's request. Reason `logout`.
- **Outbox** — The table a domain event is written to in the same transaction as the change it describes, and read back out of by the relay - every topic of it, whether or not anything listens.
- **Password hash** — What is stored in place of a password: algorithm, cost, salt and digest.
- **Password policy** — The rules a new password must satisfy. Applies when a password is created, never when one is checked.
- **Policy** — A rule of the form "when this fact happened, do that", spanning two aggregates: revoke sessions on password change. Subscribed to the bus by assembly.
- **Reason** — Why a session ended: `logout`, `revoked`, `password-changed`, `risk-blocked`. A closed set.
- **Refusal** — The one answer every failed credential check gets: malformed address, unknown address, wrong password, locked account.
- **Register** — Create a user from a credential.
- **Revoke** — End a session deliberately, with a reason. Terminal; a revoked session never comes back.
- **Risk** — The service asked whether a login attempt should go ahead.
- **Session** — Proof that a user logged in, how long that proof is good for, and whether it has been taken away.
- **Threshold** — The number of wrong passwords in a row that locks an account. One value for everybody.
- **Token** — The opaque string a client presents instead of a credential. Carries no claims.
- **User** — A person as this context knows them: an id, an email address and a password hash.
- **Validate** — Resolve a token to a live session: who is calling and until when. Reads only.
- **Verdict** — Risk's answer, in this context's words: `allow` or `block`.
- **Version** — The number the store compares before writing an aggregate. Zero means never stored.
