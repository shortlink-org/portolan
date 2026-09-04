---
name: ddd-domain-event
description: Define a domain event — what it is named, what it carries, what it must not carry, and when not to publish one at all. Use when adding an event, choosing its payload, or deciding whether something that happened deserves an event, in any language.
---

# Domain event

An event is a fact that has already happened. It is immutable: a fact that
can be edited after the fact is not a fact.

## Rules

**Past tense, named for the fact.** `UserRegistered`, `PasswordChanged`,
`SessionEnded`. Not `ChangePassword`, not `PasswordUpdate`.

**Every event answers three questions:** its name, whose fact it is (the
aggregate id), and when it happened *in the domain*. Not when it was
published, which can be much later and is the bus's business.

**Fields are private and set once by a constructor.** Readers get accessors.

**The name is a stable constant.** A publisher and a subscriber have to agree
on it, and a typo in a string literal is a subscription that silently never
fires. Renaming an event is a breaking change for every consumer.

**The payload carries what a consumer needs to react, and nothing secret.**
`PasswordChanged` says the password is different now; it carries no password,
old or new, in any form. `SessionStarted` carries the expiry so that nobody
has to ask for it later.

**Opaque fields stay opaque.** `by` on `PasswordChanged` is whoever made the
change, as a string the producing domain does not interpret. Somebody
downstream may recognise one of its own, and that is their business.

**A reason is a closed set.** A consumer that switches on it should not have
to handle free text. Each value is told apart because a consumer would act
differently: "you were signed out because the password changed" versus "sign
in again, your account was locked down".

**No event for a non-event.** Expiry publishes nothing: no code ran, nobody
decided anything, and every consumer already knows the expiry from the start
event. Revoking an already-revoked session publishes nothing. An event here
would be an invention, published by whichever sweep noticed first.

**Events are returned by the command and stored with the aggregate.** See
[ddd-aggregate](../ddd-aggregate/SKILL.md): the command returns the event,
`Save` takes it, and the adapter writes both in one transaction.

## Naming the topic

Events travel under `<context>.<EventName>` (`auth.PasswordChanged`). The
context prefix is what lets two services publish a `Created` without
colliding. Schema versions, when needed, go in the path, not the name.

## Checklist

- Past tense; immutable; constructor; accessors.
- Name, aggregate id, occurred-at.
- Name is a constant shared by publisher and subscriber.
- No secrets; opaque identifiers stay opaque; reasons are enumerated.
- Nothing published where nothing happened.

Language-specific: [references/go.md](references/go.md).
