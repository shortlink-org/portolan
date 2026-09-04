# authenticate

Checks an address and a password, and says which user they belong to.

It issues nothing. Turning a checked credential into a session is the session
domain's business, and the only caller of this use case is `login`.

## What it does

1. Looks the user up by address. Not found is folded into the one refusal
   before it leaves.
2. Asks the user to check the password.
3. Answers with the user id, and nothing else.

## What follows from it

**Every way of failing looks the same.** An unknown address, a wrong password, a
malformed address and a password that today's policy would refuse all come back
as one refusal with nothing else in it. Telling them apart would say which
addresses are registered, and a policy failure reported here would say how long
a password has to be.

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
| anything else | one refusal, the same every time |

## Sequence

This use case has no flow of its own: it is the second step of
[Login](../../../../../../../docs/flows/auth-login.md), reached through the `Authenticator` port that
assembly binds to it.
