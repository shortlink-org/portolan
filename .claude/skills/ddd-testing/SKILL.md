---
name: ddd-testing
description: Test domain rules, application orchestration and infrastructure guarantees at their owning boundaries. Use when changing tests in a layered service, choosing mocks versus a real backend, or validating event delivery and transactions.
---

# Testing

Read the target service's accepted architecture and test configuration first.
Current auth uses package-local Mockery mocks for application and policy tests;
Postgres and Redis belong in infrastructure, platform and composition tests.
Do not restore the old all-use-cases-on-a-database harness.

## Choose the boundary

| Layer | Exercise | Dependencies |
|---|---|---|
| domain and pure services | invariants, commands, value policies, lifecycle | values and explicit time; no I/O |
| application slice | ordering, refusals, commands, results, expected writes/events | package-local mocks of consumed ports |
| policy | integration DTO to receiving command, failures and redelivery | mock the injected use case |
| repository/outbox/UoW | real commit/rollback, optimistic conflict, event mapping | real backend, local fixture setup |
| cache | invalidation, transaction bypass, backend outage | mocks for unit cases; Redis for backend semantics |
| HTTP | request mapping, authentication, public errors | generated server and mocked use cases |
| projector | stream ordering and atomic rows/checkpoint | real store for transaction/concurrency guarantees |
| composition | bindings and shared transaction lookup | focused assembled integration tests |

Use deterministic clocks and id generators where the operation consumes them.
Name tests for business rules or infrastructure guarantees. In auth mocks are
configured by package-local `.mockery.yml`; regenerate only affected packages.
Keep setup helpers local instead of creating another shared test package.

## Events and versions

Assert what actually commits. A recording in-process bus alone does not verify
the outbox or after-commit delivery. Repository tests must cover a failed outbox
append rolling back the aggregate and a failed aggregate write appending nothing.

A refusal normally has no success event, but some refused commands intentionally
change state (a blocked login ends sessions; credential failures update lockout).
Assert the events and writes the documented business rule requires.

For ordered consumers test: 1 then 2; duplicate 2; 3 arriving before 2; recovery
of the missing position; two consumers racing; failure between effect and
checkpoint; replay from a snapshot checkpoint. A gap changes neither rows nor
checkpoint, and a redelivery repeats no effects. See
[ddd-domain-event](../ddd-domain-event/SKILL.md).

A query's no-write contract is verified by read-only ports or explicit negative
mock expectations, not by omitting an observer. Query orchestration can use
mocks; SQL readers require backend tests for their SQL semantics.

## Running checks

Run the focused checks covering the change. Local backend-dependent tests may
skip when Docker is absent, with the skip reported. A required integration CI
job must provision its backend and fail if the required checks cannot run.
Do not claim transaction guarantees from a mocked test or a skipped backend test.

Current Go examples: [references/go.md](references/go.md).
