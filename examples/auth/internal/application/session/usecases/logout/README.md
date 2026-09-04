# logout

Ends the session behind a token.

## What it does

1. Resolves the token to a session. A token that resolves to nothing is
   treated as already logged out.
2. Revokes it with reason `logout` and stores it, recording `SessionEnded` in
   the same transaction, unless it was already revoked.

## What follows from it

**An unknown or malformed token is not an error.** The caller asked for there to
be no session, and afterwards there is none. Failing would say which tokens
exist, and would break a client's retry after a network timeout for no reason.

**Logging out twice is fine, and announces itself once.** The second call ends
nothing, so it publishes nothing - there is no second `SessionEnded` describing
an ending that did not happen.

**Only this session ends.** The user's other devices are untouched.

## Answers

There is no answer beyond success. Either the session is gone afterwards, or the
call failed on this side.

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../docs/flows/auth-logout.md), where each hop carries its source line and
whether it was seen running.
