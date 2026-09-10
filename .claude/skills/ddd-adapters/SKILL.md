---
name: ddd-adapters
description: Write an infrastructure adapter — a repository over a database, an outbox publisher, a cache in front of a store, an in-process bus, or a client for another service. Use when implementing a port the domain or a use case declared, adding a cache, mapping storage errors, or calling an external service, in any language.
---

# Adapters

An adapter implements consumer-owned ports. One implementation may satisfy
several small compatible ports, as auth's password adapter does. Infrastructure knows the
domain; the domain does not know infrastructure exists.

## Repository

- **Not one statement mentions a transaction.** The unit of work puts one in
  the context and the driver runs on it, so the same code is correct on its
  own or inside a wider transaction somebody else opened. How the unit of
  work is shaped, joined and bypassed is
  [ddd-unit-of-work](../ddd-unit-of-work/SKILL.md).
- **The schema lives with the store that reads it.** Migrations are a
  directory inside the aggregate's repository package, numbered from 1
  within that package, applied by the migrator under a name that is the
  aggregate's. A table exists because an aggregate exists, so its schema is
  not in a pile at the root. Two aggregates' stores never share a table and
  never reference each other's; that is what lets each numbering start at 1
  and neither wait for the other. Down migrations are not written: dropping
  the table is not a rollback but a way to lose everything.
- **`Save` writes the aggregate and publishes its events in the same
  transaction.** Insert when the version is zero, update otherwise.
- **Update compares the version.** `WHERE id = ? AND version = ?`, and zero
  rows affected is the conflict error: either the row is gone or the version
  moved on, and the answer to both is "read it again".
- **Storage errors are translated into domain errors, by constraint name.**
  Two rules can land on the same unique-violation code; the constraint tells
  them apart, and answering with the wrong one sends a caller to fix
  something that is not broken.
- **Returns copies.** Never the object a cache or map holds.

## Publisher (outbox)

- Map domain events to the module's public integration DTOs inside the same
  transaction that stores the aggregate, following `auth.0013`.
- Append using the shared transaction lookup; refuse publication outside it.
  Deliver after commit to integration-event buses and policy consumers.
- Preserve record identity and version across relay retries. Ordered streams
  and projectors obey [ddd-domain-event](../ddd-domain-event/SKILL.md): strictly
  version + 1, duplicate no-op, recover gaps, atomic effect/checkpoint.
- Auth's legacy unversioned dispatcher acknowledges unknown names and fails
  malformed known payloads. A required unknown record in a new ordered stream
  needs compatibility recovery; acknowledging it as irrelevant is not safe.

## Cache (decorator)

- **Implements the same port and holds one.** Nothing above can tell which
  it got; not one use case changes to add caching.
- **Only the hot path is cached.** A read that precedes a write goes
  straight through. A query over a set is not cached: nothing can invalidate
  it honestly, because the write that changes the answer never knew the list
  existed.
- **Inside a transaction the cache is not consulted.** A decision on a copy
  taken before the transaction began is a decision on something the
  transaction never saw.
- **Every cache failure is swallowed.** The database is still there; a
  service that returns 500 because the cache is unreachable made itself less
  available by trying to be faster. This is a place that wants a metric.
- **Misses are not cached.** Otherwise whoever sends made-up keys decides
  what the cache holds.
- Keys are prefixed with the service name; a shared cache is rarely one
  service's.

## Client for another service

- **One package knows both sides:** the port the use case declared and the
  generated client. The translation lives here and nowhere else.
- **An unknown value from the other side is an error, not a default.** The
  contract changed, and guessing which way is how a new `BLOCK` variant
  becomes a login.
- **Optional-service behaviour is explicit configuration.** Follow the target's
  adapter/client seam; auth supplies a configured permissive implementation when
  risk is disabled, and enabled risk fails closed on an unavailable peer.
- The contract copy (proto, schema) lives in the consumer's infrastructure,
  next to the generated client.

## Reader and projector

The read side of [ddd-cqrs](../ddd-cqrs/SKILL.md), in two adapters:

- **A reader implements a query's `Reader` port** and scans straight into
  the query's DTOs. It has no `Save`, hands out no aggregate and opens no
  write unit of work; it reads the tables the repository writes, and that is
  its whole coupling to the domain.
- **A projector consumes integration records and writes rows.** It owns
  migrations and a checkpoint per stream. Apply exactly the next version;
  commit rows and checkpoint together under a concurrency guard. Duplicates
  do nothing; gaps are recovered before advancing.
- **A projector opens its own transaction.** It cannot join the producer's
  already-committed transaction, but its own writes must still be atomic.
  A reader uses the read consistency required by its query contract.

## In-process bus

In current auth, the relay delivers integration DTOs to an in-process bus after
the producing transaction commits. Subscriber failure fails that delivery for
retry, not the already-committed command. A synchronous recording bus in a unit
test does not prove outbox semantics.

## Checklist

- Adapter names the consumer-owned ports it implements; use cases depend on those contracts.
- No transaction handling in statements; unit of work per [ddd-unit-of-work](../ddd-unit-of-work/SKILL.md).
- Migrations inside the store package, numbered per aggregate, no cross-aggregate references, no down files.
- Version compared on update; zero rows is conflict.
- Storage errors mapped to domain sentinels by constraint.
- Cache: same port, hot path only, bypass in transaction, failures swallowed, misses not stored.
- External client: unknown enum is an error; disabled and unavailable modes are distinct.
- Reader returns slice-owned DTOs. Projector commits rows/checkpoint locally, strictly version + 1; duplicate no-op, gaps recovered, own migrations.

Language-specific: [references/go.md](references/go.md).
