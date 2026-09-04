# authenticate

Checks an address and a password, and says which user they belong to.

It issues nothing. Turning a checked credential into a session is the session
domain's business, and the only caller of this use case is `login`.

## What it does

1. Looks the user up by address. Not found is folded into the one refusal
   before it leaves, and before anything is counted.
2. Asks the lockout whether this account accepts a password right now. A
   locked account is refused here, with the password unchecked.
3. Asks the user to check the password, and tells the lockout how it went:
   a wrong one counts, and the fifth in a row locks the account for fifteen
   minutes; a right one clears the count.
4. Answers with the user id, and nothing else.

## What follows from it

**Every way of failing looks the same.** An unknown address, a wrong password, a
malformed address and a password that today's policy would refuse all come back
as one refusal with nothing else in it. Telling them apart would say which
addresses are registered, and a policy failure reported here would say how long
a password has to be.

**A locked account looks exactly like a wrong password.** Same refusal, same
status, so a lock cannot be used to confirm that an address is registered
any more than a wrong password can. A locked account and an unknown address
both skip the hash, so neither is slower than the other.

**The lock is per account, and an unknown address has none.** Nothing is
counted for an address that is not registered, so guessing at addresses
locks nobody, and nobody can lock somebody else by typing their address with
junk.

**A lockout that cannot be reached stops the check.** The lockout store being
down is answered as an error, not as "allowed" and not as the refusal:
either would quietly turn the service back into unlimited guessing.

**Sessions are untouched by a lock.** A lockout means somebody has *not* got
the password. The sessions the account has are the owner's and stay open;
compare a risk block, where the attempt had the right password and every
session is ended.

**A password that the current policy would refuse is still checked.** The policy
governs the creation of a password, not its presentation: raising the minimum
must not lock out everyone who registered under the old one.

## Not on the HTTP surface

There is deliberately no endpoint for this. A call that checks a password
without issuing a session is an oracle for guessing at them.

## Answers

| | |
|---|---|
| the credentials are good | the user id, and nothing else |
| anything else, a locked account included | one refusal, the same every time |
| the lockout could not be asked or told | the error, and no answer about the credentials |

## Sequence

This use case has no flow of its own: it is the second step of
[Login](../../../../../../../docs/flows/auth-login.md), reached through the `Authenticator` port that
assembly binds to it.
