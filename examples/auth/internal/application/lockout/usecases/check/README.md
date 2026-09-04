# check

Answers whether an account accepts a password right now.

## What it does

1. Loads the user's lockout. A user without one has never typed a wrong
   password and is allowed.
2. Asks the lockout whether it allows an attempt at this moment.

## What follows from it

**It writes nothing.** Asking is not an attempt. The count moves only when a
password has actually been checked, in `record_failure` and `record_success`.

**A lock that has run out is answered as allowed** without anything having
cleared it. The state is read off the time; nothing sweeps.

## Answers

| | |
|---|---|
| never a wrong password, or the count is under the threshold, or the lock ran out | allowed |
| locked | not allowed |

## Sequence

This use case has no flow of its own: it is a step of
[Login](../../../../../../../docs/flows/auth-login.md), reached through the
`Lockout` port that assembly binds to it.
