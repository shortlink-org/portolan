# change_password

Replaces the password of a user, given the current one.

## What it does

1. Checks the current password. A wrong one is refused with exactly the answer a
   failed login gets, so this is not a cheaper way to test guesses than the
   front door.
2. Applies the password policy to the new one.
3. Stores the new hash and records `PasswordChanged`, in one transaction.

The current password is required even though the caller is already signed in.
Without it a stolen token is a stolen account: whoever holds it sets a new
password and the owner is locked out of their own.

## What follows from it

**Every other session of the user ends.** The one the change was made from does
not, so nobody is signed out of the device in their hand.

**Not at the same instant.** For a moment afterwards the other devices still
work. Anything signed in during that moment survives - it was issued against the
new password, so ending it would be wrong.

Neither of those happens here. This use case announces that the password
changed; ending sessions is a rule about sessions, applied by the policy in
`internal/application/policy`. Any other way a password comes to change - a
support reset, an import - gets the same behaviour without asking for it.

## Answers

| | |
|---|---|
| the change was made | no content |
| the current password is wrong | refused, indistinguishable from a bad token |
| the new password breaks the policy | refused, with every rule it broke |
| the user was changed by somebody else meanwhile | read it again and retry |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../docs/flows/auth-change-password.md), where each hop carries its source line and
whether it was seen running.
