# register

Creates a user from an email address and a password.

## What it does

1. Normalises and validates the address.
2. Refuses an address that is already registered.
3. Hashes the password and stores the user, recording `UserRegistered` in the
   same transaction.

## What follows from it

**A second registration of the same address is refused, not quietly successful.**
Returning the existing user would answer a request to create something with
something that was already there, and the caller would have no way to tell.

**The address is one address however it is typed.** `Ada@Example.com ` and
`ada@example.com` are the same registration; what is stored is the normalised
form.

**A refusal writes nothing and announces nothing.** No user, no event.

## Answers

| | |
|---|---|
| created | the user id, the address as stored, and when |
| the address is taken | refused |
| the address or password breaks a rule | refused, with every rule it broke |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../docs/flows/auth-register-user.md), where each hop carries its source line and
whether it was seen running.
