---
name: ddd-domain-event
description: Define immutable domain facts and their public integration contracts, including transactional publication and strict stream versions. Use when adding events, changing wire payloads, or designing ordered consumers.
---

# Domain and integration events

A domain event is an immutable fact returned by an aggregate operation. Its
name is in the past tense and its data identifies the aggregate and business
occurrence time. It carries no secrets; a no-op returns no event.

## Two representations

Follow `auth.0013`: `domain/event` holds in-process facts; a module's
`integration/event` holds public DTOs, stable names, serialization and mapping.
Consumers and policies depend on that integration contract, not aggregate
internals. Store the changed aggregate and append its mapped outbox messages
in the same transaction. Dispatch after commit.

Event names (`auth.PasswordChanged`), broker topics (`auth_user`), schema
versions and stream versions are different concepts. A rename or schema change
needs a compatibility plan. A schema version describes payload shape; it is
never used as an ordering counter.

## Strict ordered streams

For new ordered integration streams, require a stable `streamID` and integer
`version`. The first committed position is 1 and each following position is
exactly the previous version + 1. Allocate the version and persist the immutable
payload in the same transaction as the aggregate change. Retry delivery of the
same committed event with the same identity and version; do not allocate again.

Use `(streamID, version)` as the identity of one immutable stream record.
`streamID` includes the producer/context, aggregate kind and aggregate id so
unrelated roots cannot collide. Multiple events from one save must either be
one ordered record containing an atomic batch, or get consecutive positions
in a separate stream counter. Do not label distinct records with the same pair.

The aggregate's optimistic version can be the stream version only when every
committed increment is represented by exactly one delivered record. Otherwise
allocate a distinct transactional stream sequence. A consumer of selected event
types must still receive all positions and explicitly account for irrelevant
ones, or consume a separately sequenced stream. Never infer order from time.

For each consumer and stream, persist `lastVersion`, initially 0:

| Incoming version | Action |
|---|---|
| `lastVersion + 1` | apply effects and advance the checkpoint atomically |
| `<= lastVersion` | already committed; acknowledge without repeating effects |
| `> lastVersion + 1` | gap; apply nothing and do not advance the checkpoint |

Serialize competing consumers with a lock or compare-and-swap in the same
transaction as the effect. Keep the checkpoint after a projection row is deleted.
A gap requires fetching missing history or durably parking the record while
missing positions arrive; bounded retries alone cannot reconstruct lost history.
Acknowledge a parked record only after durable ownership has transferred. Alert
on unresolved gaps and define recovery; never jump to the highest seen version.

A supported-but-irrelevant record may advance the checkpoint as an explicit
no-op. An unknown type/schema in a required ordered stream is not automatically
irrelevant: stop/park for compatibility handling. Auth's existing unversioned
relay acknowledges unknown names; that legacy behaviour must not be copied into
a new ordered projector. A repeated pair with different content is a producer
contract violation, not a new event.

For external effects, the checkpoint cannot make a remote call atomic: use an
outbox and stable idempotency key at the receiving side, or a durable process.

## Replay and verification

Name the retained event log or versioned snapshot plus suffix used for recovery.
An outbox with cleanup is not automatically a replay log. Bootstrap from a
consistent snapshot/checkpoint or position 1; never treat the first arrival as
an arbitrary new baseline. Track independent streams independently.

Test mapping round trips, rollback of state plus outbox, duplicates, gaps,
concurrent consumers and checkpoint rollback. For a projector see
[ddd-cqrs](../ddd-cqrs/SKILL.md).

Current Go types and the versioning extension: [references/go.md](references/go.md).
