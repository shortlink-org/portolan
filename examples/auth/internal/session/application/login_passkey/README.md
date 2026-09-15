# login_passkey

Turns a passkey assertion into a session.

## What it does

1. Asks the verifier whose passkey signed the assertion.
2. Asks the risk service whether this attempt should go ahead, the same way a
   password login does.
3. Only then starts a session, storing it and recording `SessionStarted` with
   the method `passkey` in one transaction.

## What follows from it

**This package does not know how an assertion is checked.** It states what it
needs - an assertion in, a user id out - and is handed an adapter over the
webauthn service at assembly. The service being unreachable is not a verdict:
nothing is issued.

**A rejected assertion has one answer.** An unknown credential and a wrong
signature both come back as `ErrRejected`, answered like a bad password.

## Answers

| | |
|---|---|
| signed in | the token, and when it stops working |
| the assertion does not check out | `ErrRejected` |
| risk blocked the attempt | `ErrBlocked` |
