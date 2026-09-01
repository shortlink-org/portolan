# logout

Ends the session behind a token.

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
