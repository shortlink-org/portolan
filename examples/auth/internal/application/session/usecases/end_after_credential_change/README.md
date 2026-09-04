# end_after_credential_change

Ends the sessions a credential change invalidates.

Nothing calls this directly. It runs when a password changes, through the policy
in `internal/application/policy`, so every way a password can change gets it
without asking.

## What it does

1. Loads every session of the user, live or not.
2. Asks the domain service which of them the change ends: those issued
   before it, still live, and not the one the change was made from.
3. Revokes each with reason `password-changed` and stores it, one
   transaction per session, re-reading and retrying on a conflict.

## What follows from it

**It knows nothing about passwords.** The input is whose credentials changed,
when, and which session made the change. That something about them changed is
all this package is told.

**Which sessions die is not decided here.** That is a domain service, so the
rule can be read and tested without a store: sessions started *after* the change
survive, because they were issued against the new credentials; already revoked
or expired ones are left alone, because ending them again would announce an
ending that already happened.

**Each session is its own transaction.** One write covering all of them would
span several aggregates, and one unlucky conflict would undo every other
revocation. A session somebody changed in the meantime is read again and retried
rather than abandoned.

**One event per session actually ended**, naming the reason - so a client can say
"you were signed out because the password changed" instead of blaming an expiry
that did not happen.

## Answers

| | |
|---|---|
| the sessions were ended | nothing; the events say which |
| a session was changed meanwhile | read again and retried, up to a limit |
| a session vanished meanwhile | nothing left to end; passed over |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../docs/flows/auth-revoke-sessions-on-password-change.md), where each hop carries its source line and
whether it was seen running.
