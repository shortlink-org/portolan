---
name: ddd-unit-of-work
description: Draw the transaction boundary of a service — one aggregate change per transaction, the unit of work carried in the context, re-entrant, joined by repositories and the outbox, bypassed by caches. Use when a repository writes, when a use case touches two aggregates, when events must commit with the change that produced them, when looping over independent aggregates, or when a cache sits in front of a store, in any language.
---

# Unit of work

The transaction boundary is an aggregate change: the aggregate's new state
and the events that describe it, committed together or not at all. The unit
of work is how every write finds the same transaction without being told.

## Rules

**The transaction lives in the context, under one key.** The database
driver, the outbox and the cache all look for it in the same place, handed
the same lookup at assembly. Wiring that lookup is not optional: without it a
statement takes another connection, runs outside the transaction's locks,
and can deadlock against it.

**The unit of work is re-entrant.** Called while a transaction is in flight,
it runs on that one. That is what lets a repository open a transaction for
its own sake and a use case wrap several repositories, with the inner calls
joining in. The alternative is every use case remembering to open one, and
the first that forgot being silently non-atomic.

**A repository opens one for each `Save`.** Storing the aggregate and
recording its events is one transaction, always, whether or not the caller
opened a wider one.

**The outbox publisher joins the transaction in flight and refuses to run
outside one.** A fact about a change that did not commit is worse than no
fact; a change nobody was told about is the other half of the same bug.

**A saved copy is not refreshed by the save.** `Save` writes the version it
was handed and does not bump the copy in memory; whoever wants to write
again reads again. A second `Save` on the same copy is a conflict, by design:
the read is what tells the caller whether anybody else got there first.

**Not one repository statement mentions the transaction.** The same code is
correct alone and inside a wider unit; the context carries the difference.

**One aggregate per transaction, by default.** A use case that changes
several *independent* aggregates does so one transaction each. One write
covering all of them would mean one unlucky conflict undoing every other
change. A conflict on one is re-read and retried; the rest proceed.

**Two aggregates in one transaction only when the rule needs both to
change together.** Then the use case wraps both saves in the unit of work,
and the repositories join it. This is rare, and the comment says why.

**A conflict is not a failure of the loop.** In a loop over aggregates, a
version conflict on one means somebody else wrote it (a logout from that
device, say). Re-read it, redo the change; if there is nothing left to do,
move on.

**Inside a transaction the cache is not consulted.** A read through the
cache would decide on a copy taken before the transaction began, one the
transaction never saw and cannot have locked.

**Tests reach the store the same way.** The harness builds the store with
the same transaction lookup assembly wires; a test that reached it any other
way would exercise a path the service does not have, and the lookup is the
thing most worth not getting wrong.

## What joins the unit

| Component | Behaviour inside a unit |
|---|---|
| repository `Save` | runs on the transaction; opens one if none |
| outbox publisher | appends to the same transaction; refuses without one |
| cache decorator | bypassed on reads |
| second repository | joins; commit is shared |
| external service call | not transactional; make it before the write, treat failure as no decision |
| query use case, reader | opens none and joins none; a query changes nothing ([ddd-cqrs](../ddd-cqrs/SKILL.md)) |
| projector | never inside; it runs behind the outbox, after the commit it reflects |

## Checklist

- One lookup, handed to driver, outbox and cache at assembly.
- Re-entrant `Do`; repositories never handle transactions in statements.
- `Save` = aggregate + events, one unit; a saved copy is stale, re-read before writing again.
- Loops over independent aggregates: one unit each, conflicts retried per item.
- Cache bypassed when a transaction is in flight; no command reads a projection.
- Test harness uses the same lookup.

Language-specific: [references/go.md](references/go.md).
