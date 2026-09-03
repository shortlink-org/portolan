# login

Turns credentials into a session.

## What it does

1. Asks whoever can check credentials whether these are good.
2. Asks the risk service whether this attempt, credentials and all, should go
   ahead.
3. Only then starts a session, storing it and recording `SessionStarted` in one
   transaction.

The order is the rule: a session is never issued for a user the user domain did
not vouch for, and never for an attempt risk judged hostile.

A blocked attempt is treated as the account being compromised - whoever is
trying has the right password - so every session the account has is ended,
with the reason `risk-blocked` on each `SessionEnded`, and only then is the
attempt refused.

## What follows from it

**This package does not know how a password is checked.** It states what it
needs as an interface - credentials in, a user id out - and is handed something
that can do it at assembly. The session domain never imports the user one.

**This package does not know where risk lives either.** It states what it
needs - an attempt in, a verdict out - and is handed an adapter over the
service's generated client at assembly. Risk being unreachable is not a
verdict: nothing is issued and nothing is ended.

**A refusal is passed through untouched.** Translating it here would be the one
way to accidentally make a wrong password distinguishable from an unknown
address.

**Every login is its own session.** Two sessions never share a token, so logging
out on one device does not end the other.

## Answers

| | |
|---|---|
| signed in | the token, and when it stops working |
| the credentials are not good | the refusal, exactly as it came back |
| risk blocked the attempt | `ErrBlocked`, after the account's sessions were ended |

The session id is not in the answer. It names a row in this service's store, is
of no use to a client, and putting it on the wire would invite something to be
built on it.
