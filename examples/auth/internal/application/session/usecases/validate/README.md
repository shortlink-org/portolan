# validate

Resolves a token to a live session: who is calling, and how long the answer
stays good.

This is the hot path. Every authenticated request in the estate ends here.

## What it does

1. Parses the presented string as a token; one that is not shaped like ours
   is treated as unknown.
2. Looks the session up by token, through the cache on the way to the store.
3. Asks the session whether it may be used now, and answers with who and
   until when.

## What follows from it

**It writes nothing.** No session is touched by being checked, so this reads and
returns.

**Nothing about a token is ever explained.** Unknown, malformed, expired and
revoked are one refusal. A token that is not even shaped like one of ours is
reported as unknown rather than as a parse failure: outside this service the two
are the same answer, and telling them apart only helps somebody probing the
format.

**Expiry is decided when the token is presented, not by a sweep.** A session
past its time is refused whether or not anything got round to removing it.

## Answers

| | |
|---|---|
| live | the user id, and when the session expires |
| anything else | one refusal, the same every time |

The session id is in the result but not on the wire: changing a password has to
know which session to spare, and a client has no use for it.

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../docs/flows/auth-validate-session.md), where each hop carries its source line and
whether it was seen running.
