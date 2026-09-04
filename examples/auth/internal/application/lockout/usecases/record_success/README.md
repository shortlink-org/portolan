# record_success

Clears the count of wrong passwords after a right one.

## What it does

1. Loads the user's lockout. A user without one has nothing to clear, and
   nothing is written.
2. Clears the count and stores it, if there was anything to clear.

## What follows from it

**The common login writes nothing here.** Almost everybody has never typed a
wrong password, so this is one indexed read on the way in, not a write.

**No event.** A count going back to zero is bookkeeping, not a fact with a
consumer; announcing it on every login would be noise.

**A locked account is never cleared this way.** Its password is refused
unchecked, so a success cannot be reported for it; if one ever were, the
lock is what stands.

## Answers

| | |
|---|---|
| nothing to clear | nothing, and no write |
| cleared | nothing |
| conflicting writes kept winning | the conflict, after three tries |

## Sequence

This use case has no flow of its own: it is a step of
[Login](../../../../../../../docs/flows/auth-login.md), reached through the
`Lockout` port that assembly binds to it.
