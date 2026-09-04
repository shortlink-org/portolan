# record_failure

Counts a wrong password against an account, and locks the account when the
count reaches the threshold.

## What it does

1. Loads the user's lockout, or starts one on the first wrong password.
2. Passes over an account that is already locked: the password was refused
   unchecked, so nothing was learned about it.
3. Records the failure. The one that reaches the threshold locks the account
   and records `AccountLocked`, in one transaction with the count.
4. On a conflict, reads again and counts on top of whoever got there first.

## What follows from it

**The count is per account, not per address or per client.** An unknown
address never reaches here: `authenticate` refuses it before anything is
counted, so guessing at addresses locks nobody and the answer outside stays
the same.

**Two wrong passwords at once both count.** A conflict on the write is the
loser reading again, not a failure dropped. The write that reaches the
threshold is the one that locks, whichever arrived first.

**Nothing here ends sessions.** Unlike a risk block, a lockout means somebody
has *not* got the password; the account's sessions are the owner's and stay.

## Answers

| | |
|---|---|
| counted, under the threshold | nothing |
| counted, and it locked the account | nothing; `AccountLocked` says so |
| already locked | nothing; not counted |
| conflicting writes kept winning | the conflict, after three tries |

## Sequence

This use case has no flow of its own: it is a step of
[Login](../../../../../../../docs/flows/auth-login.md), reached through the
`Lockout` port that assembly binds to it.
