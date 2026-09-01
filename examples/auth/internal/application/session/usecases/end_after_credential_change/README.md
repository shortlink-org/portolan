# end_after_credential_change

Ends the sessions a credential change invalidates.

Nothing calls this directly. It runs when a password changes, through the policy
in `internal/application/policy`, so every way a password can change gets it
without asking.

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
