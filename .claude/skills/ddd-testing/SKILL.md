---
name: ddd-testing
description: Test a service built in layers — the aggregate and value objects without I/O, domain services without a store, use cases against a real database with ports satisfied inline, adapters against the real backend. Use when writing or reviewing tests for any of those, deciding what to fake, or fixing time in a test, in any language.
---

# Testing

Each layer is tested at the boundary it owns. Nothing is mocked that can be
run for real cheaply, and nothing is run for real that the layer does not
touch.

## Rules

**Domain tests need no I/O.** Aggregate commands, value object rules, and
domain services are called with values and asserted on their return. A
domain service is handed aggregates built by the domain's own constructors
and asked for its decision.

**"Now" is a fixed value.** Every constructor and command takes time as a
parameter, and the use case takes a clock; tests pass a constant. A test that
reads the wall clock is a test that fails on a slow machine.

**A port is satisfied inline, as a function.** The use case declared
`Authenticator` as one method; the test defines a function type that
implements it and writes three-line helpers named for what they do:
`vouches(userID)`, `refuses()`, `allows()`, `blocks()`. No mocking library.

**A use case is tested against a real database.** The harness builds the
repository over a real store reached exactly the way the service reaches it,
with the same transaction lookup assembly wires. A test that reached the
database any other way would exercise a path the service does not have, and
the transaction lookup is the thing most worth not getting wrong.

**Isolation is a database per test.** One container serves the package; each
test gets its own schema. Cheap and total.

**Events are asserted.** The harness subscribes an in-process bus that
records everything published, and a test says how many events and which. A
refused login announces nothing; a successful one announces exactly one
`SessionStarted`.

**A test is named for the rule it pins.** "No session without the
authenticator", "authenticator failure is not rewritten", "ends sessions
older than the change". The comment above it says why the rule exists. A
test that fails should tell the reader which rule broke.

**Skip, do not fail, when the backend is unavailable.** A machine without
Docker still runs the domain tests, and the run stays honest about what it
did not do.

**Adapters are tested against their backend.** Repository against Postgres,
cache against Redis, with the same harnesses. The cache test checks the
rules that are about caching: bypass inside a transaction, survival of a
cache outage, a miss not being stored.

## What to fake, what to run

| Layer | Runs for real | Faked |
|---|---|---|
| aggregate, value object, domain service | everything | nothing |
| use case | repository over a real database, in-proc bus | other domains' ports, external services, clock |
| adapter | its backend | nothing |
| policy | the use case it calls, over a real database | the event, built by its constructor |
| transport | the generated server | the use cases, as interfaces |

## Checklist

- Domain tests import no infrastructure.
- Fixed `now`; injected id generator.
- Ports faked as function types with intention-revealing helpers.
- Use case harness: real store, recording bus, per-test database.
- Every test names a rule; refused paths assert no events.

Language-specific: [references/go.md](references/go.md).
