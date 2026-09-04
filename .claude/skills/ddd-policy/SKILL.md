---
name: ddd-policy
description: Write a domain service (a pure decision across several aggregates) or a policy ("when X has happened, do Y" across aggregates, driven by an event). Use when a rule belongs to no single aggregate, when one aggregate's change must cause something in another, or when tempted to call a second use case from inside a first, in any language.
---

# Domain service and policy

Two homes for a rule that does not sit on one aggregate. A **domain service**
decides; a **policy** reacts.

## Domain service

A decision that belongs to the domain but needs several aggregates, and no
I/O.

- **Pure.** It is handed the aggregates it reasons about and returns an
  answer. Loading them and writing the outcome is the caller's job. That
  keeps the decision testable without a store and stops the package becoming
  a second home for use cases.
- **Imports the aggregate; never the reverse.** An aggregate does not call
  its own domain service; somebody outside does.
- **Exists because the decision is not obvious.** "Revoke everything" on a
  password change is wrong twice: it ends the session the change was made
  from, and it ends sessions started against the *new* password while the
  event was in flight. The service spells out what survives.
- **Time comes from the event, never the clock.** The two differ once
  anything is asynchronous, and the difference is exactly the aggregates
  changed in between.

## Policy

"When X has happened, do Y", where X and Y belong to different aggregates.

- **Hangs off the fact, not off the use case that produced it.** Every way a
  password can change — the owner, a support reset, an import — publishes
  the same event, and each gets the behaviour without asking. Written as a
  call inside one flow, the rule would have to be remembered at every new way
  in, and the one that forgot would silently not have it.
- **One of two places that knows two domains exist** (the other is
  assembly). Aggregates never import each other; the policy imports one
  domain's event and the other domain's use case.
- **Reacts to one event; passes over everything else.** Anything else on the
  bus is not this policy's business and is not an error.
- **Calls a use case; does not reach into a repository.** The policy
  translates the event into the input of a use case on the other side
  (`end_after_credential_change`), which owns its own transaction and rules.
- **Carries what the event carries.** The session to spare is `by` on the
  event; an administrative reset leaves it empty and spares nothing, which is
  what a reset is for.

## When it is neither

| You want | Use |
|---|---|
| a check on one aggregate's state | a command on the aggregate |
| a decision over several aggregates, no I/O | a domain service |
| a reaction in aggregate B to a fact from aggregate A | a policy |
| a scenario a caller asks for | a use case |

## Checklist

- Domain service has no ports and no clock; inputs are aggregates and times.
- Policy handles exactly one event type and returns nothing for the rest.
- Policy calls a use case, never a repository.
- No aggregate imports the other; the policy is the only bridge outside assembly.

Language-specific: [references/go.md](references/go.md).
