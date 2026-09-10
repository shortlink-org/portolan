---
name: ddd-aggregate
description: Design or change an aggregate — its root, identity, version, commands, the events it returns and the storage port it declares. Use when adding an entity, deciding whether two things are one aggregate or two, writing a command method, or defining a repository interface, in any language.
---

# Aggregate

The aggregate root is the transactional boundary. Every rule about its state
is enforced in the root and nowhere else, so nothing can reach past it and
leave the aggregate in a state the domain says is impossible.

## Rules

**Identity is minted once and never reused.** It is not a natural key: a user
is identified by an id, not by their email, because people change addresses.

**Choose the boundary from invariants.** List the business rules that must
remain true immediately after every committed command, including concurrent
commands. Put the state required to enforce those rules under one root.
Changes at different rates and lock contention are useful signals to reassess
size; they do not prove that an invariant can safely cross a boundary.

For each proposed split, state the allowed inconsistency window and who repairs
or compensates a partial outcome. If no temporary inconsistency is acceptable,
keep the rule atomic or document an explicit coordination design. Challenge
unbounded collections and unnecessary loading without sacrificing the invariant.

Example: changing one order line need not change the others, yet a total limit
may require those lines to stay within one consistency boundary. A session can
be separate from a user only with explicit semantics for credential changes,
revocation delay and concurrent session creation. Establish context ownership
first with [ddd-strategic-design](../ddd-strategic-design/SKILL.md).

**Version travels on the aggregate.** The store compares it before writing
and refuses a stale copy. It lives on the aggregate rather than only in the
repository so that a copy that has gone stale can say so. Zero means never
stored. The refusal is one sentinel error, and the answer to it is always the
same: re-read and re-evaluate the command before another save. Retry automatically
only where doing so preserves the caller's intent, with a bounded policy.

**A command returns its event; it does not buffer it.** An aggregate that
quietly accumulates events carries hidden state and has to know the word
"committed". Returned, the fact is visible in the signature and publishing is
the caller's business.

**An idempotent command says when it did nothing.** Revoking twice returns
"not ended" and no event. An event for a non-event is worse than no event.

**Errors belong to the layer that owns the outcome.** The aggregate owns
invariant and lifecycle errors; application owns credential-checking outcomes.
See [ddd-errors](../ddd-errors/SKILL.md) and auth's accepted `auth.0015`.

**Errors are named sentinels at the package level**, one per distinct answer
a caller can act on in this layer: not found, conflict, already taken.

**The aggregate hands out copies.** A repository never returns the object it
holds: a mutation would reach storage without a save, and a failed save would
leave the change visible. The copy is the aggregate's method, because only
the aggregate knows which of its fields is mutable.

**An aggregate with more than one state is a state machine, and the
domain package's README draws it.** States as a closed set, transitions as
commands with their events, time-derived states marked as having no event.
See [ddd-state-machine](../ddd-state-machine/SKILL.md).

**Reads and decisions are separate methods.** `Live(now)` answers a boolean;
`Validate(now)` says why not. A caller that wants to act on the reason gets
the reason.

## The storage port

The repository interface is declared **in the domain**, next to the root. It
states what the domain needs, not what any database offers.

- `Save(aggregate, events...)` takes the events the change produced. A fact
  about a change that did not commit is worse than no fact, so the adapter commits the state and supplied events together. A variadic
  signature alone does not enforce that callers supplied every required fact;
  verify this in command and repository tests.
- Queries are named by what they answer: `ByID`, `ByToken`, `ByUserID`. A
  query that exists for one caller says so in its comment, and returns what
  the *decision* needs, not what the store finds convenient (every session of
  a user, live or dead, because deciding which to end belongs to the domain).
- A separate `Publisher` port accepts domain events for transactional
  recording. Its adapter maps them to integration DTOs before the outbox append;
  consumers receive those DTOs after commit, not aggregate event objects.

## Checklist

- Root has an id, a version, and no setter that skips a rule.
- Every command returns `(event, error)` or `(event, didSomething)`.
- No import of another aggregate; references are ids.
- Repository interface lives in the domain package; `Save` takes events.
- Invariants justify the consistency boundary, including concurrent commands.
- Domain sentinels describe domain outcomes; application owns orchestration refusals.
- Domain package README lists states and draws the transitions.

Language-specific: [references/go.md](references/go.md).
