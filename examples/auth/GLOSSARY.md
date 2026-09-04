# Glossary — auth

One meaning per word inside this context. The code, the events, the API and
the model spell these the same way.

**Attempt.** What the risk service is told about a login it is asked to judge:
the user id, once the credentials have been checked. Not the credentials; risk
decides whether a correct login should go ahead today, not whether it was
correct.

**Authenticate.** Check an email address and a password and answer with a user
id or one refusal. Not login: authenticating issues nothing.

**Conflict.** The copy of an aggregate in hand is not what is stored; somebody
wrote it since it was read. Not an error to report to a person: read again,
redo, save again.

**Credential.** An email address and a password, presented together. Not a
token: a token is what a credential is exchanged for.

**Email address.** The address a user logs in with, normalised and validated on
creation. Not the user's identity; people change addresses, the id does not.

**Expiry.** The moment a session stops being usable because of time. Not an
event and not a transition: nothing runs when it happens, it is read off the
session when a token is presented.

**Lockout.** An account refusing passwords for a while after too many wrong
ones in a row: five, for fifteen minutes. One per user, from the first wrong
password on. Not a ban and not a risk block: the sessions stay, and it ends by
itself.

**Locked.** The state of a lockout while it refuses. Read off the time; nothing
runs when it ends. Not revoked: a lock says nothing about the sessions.

**Login.** Turn a credential into a session: authenticate, ask risk, start.
Not authenticate, which is one step of it.

**Logout.** End the session behind a token, at the user's request. Reason
`logout`. Not revocation by somebody else.

**Outbox.** The table a domain event is written to in the same transaction as
the change it describes, and read back out of by the relay. Not the bus: the
bus is what the relay hands the event to.

**Password hash.** What is stored in place of a password: algorithm, cost,
salt and digest. Not the password; the plaintext never lives on an aggregate.

**Password policy.** The rules a new password must satisfy. Applies when a
password is created, never when one is checked.

**Policy.** A rule of the form "when this fact happened, do that", spanning two
aggregates: revoke sessions on password change. Not a use case; nobody calls
it, an event does.

**Reason.** Why a session ended: `logout`, `revoked`, `password-changed`,
`risk-blocked`. A closed set. Not free text.

**Refusal.** The one answer every failed credential check gets: malformed
address, unknown address, wrong password, locked account. Not four answers;
that is the point of it.

**Register.** Create a user from a credential. Not login: registering does not
start a session.

**Revoke.** End a session deliberately, with a reason. Terminal; a revoked
session never comes back. Not expiry.

**Risk.** The service asked whether a login attempt should go ahead. Not part of
this context; its answer is translated into a verdict at the boundary.

**Session.** Proof that a user logged in, how long that proof is good for, and
whether it has been taken away. Not the token: the token is a secret the
session carries, not what it is called.

**Threshold.** The number of wrong passwords in a row that locks an account.
One value for everybody. Not a per-user setting.

**Token.** The opaque string a client presents instead of a credential. Carries
no claims. Not the session's identity; the session has an id of its own that
never goes on the wire.

**User.** A person as this context knows them: an id, an email address and a
password hash. Not a profile, not a customer; other contexts hold their own
view and reference this one by id.

**Validate.** Resolve a token to a live session: who is calling and until when.
Reads only. Not authenticate: no credential is involved.

**Verdict.** Risk's answer, in this context's words: `allow` or `block`. Not the
risk service's enum; that is translated once, in the adapter.

**Version.** The number the store compares before writing an aggregate. Zero
means never stored. Not a schema version.
