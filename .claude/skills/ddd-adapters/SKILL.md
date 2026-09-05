---
name: ddd-adapters
description: Write an infrastructure adapter — a repository over a database, an outbox publisher, a cache in front of a store, an in-process bus, or a client for another service. Use when implementing a port the domain or a use case declared, adding a cache, mapping storage errors, or calling an external service, in any language.
---

# Adapters

An adapter implements one port and nothing else. Infrastructure knows the
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

- Writes each event as a message into the transaction in flight. Outside a
  transaction it refuses rather than quietly writing on its own connection.
- Sits beside the repository because both are adapters for the same domain's
  ports; neither knows about the other.
- The consumer side reads the domain's topic back and hands every event to
  the domain's bus, as a domain event, not a message: whatever reacts to a
  fact should not have to know it spent time in a table. It does not
  dispatch by name; who listens is the bus's business. Unknown event names
  are acknowledged and passed over, not failed: leaving them would block
  everything behind them, and they are not broken, just unreadable here.

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
- **A stub for running without the service is a *client*, not an adapter**,
  so the one adapter is still the only code that reads a verdict.
- The contract copy (proto, schema) lives in the consumer's infrastructure,
  next to the generated client.

## In-process bus

For tests and local runs. Delivery is synchronous, a subscriber's error fails
the publishing use case, and delivery stops at the first failure. That is the
point: silent loss is the worst outcome here. A real bus swaps the failure
for a retry and an outbox, not for a log line.

## Checklist

- Adapter names the one port it implements; nothing else is exported that a use case could reach for.
- No transaction handling in statements; unit of work per [ddd-unit-of-work](../ddd-unit-of-work/SKILL.md).
- Migrations inside the store package, numbered per aggregate, no cross-aggregate references, no down files.
- Version compared on update; zero rows is conflict.
- Storage errors mapped to domain sentinels by constraint.
- Cache: same port, hot path only, bypass in transaction, failures swallowed, misses not stored.
- External client: unknown enum is an error; stub is a client.

Language-specific: [references/go.md](references/go.md).
