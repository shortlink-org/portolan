---
name: ddd-review
description: Review a service, module or diff for DDD boundaries, invariants, integration contracts and transaction guarantees against its accepted ADRs. Use when a DDD review is requested; keep findings scoped to the requested code.
---

# Review

Read the target README, accepted ADRs and executable dependency rules first.
Treat current scoped decisions as the baseline; do not flag their deliberate
choices because another example or an older skill uses a different layout.
Current auth's baseline includes `auth.0012`–`auth.0016`. A gap in a reference
example is not proof that an uninspected target has the same gap.

For each finding provide evidence, the affected business or technical guarantee,
and a concrete correction. Distinguish correctness defects from architectural
trade-offs and documentation drift. Follow links below only for the layers
relevant to the requested review.

## Context and aggregate boundaries

- Ownership, local language and upstream/downstream contracts are explicit;
  a context is not inferred from deployment or tables alone.
  [Strategic design](../ddd-strategic-design/SKILL.md).
- Aggregate boundaries protect stated immediate invariants under concurrency.
  Frequency of changes is a sizing signal, not sufficient proof for a split.
  Cross-boundary rules state acceptable delay and repair/compensation.
  [Aggregate](../ddd-aggregate/SKILL.md).
- Commands enforce invariants; no-op and refused outcomes are deliberate.
  State and events commit together, and stale writes cannot silently overwrite.
  [Unit of work](../ddd-unit-of-work/SKILL.md).

## Modules, use cases and assembly

- Domain/application do not import peer modules or infrastructure. Ports belong
  to consumers; cross-module adapters translate in consuming infrastructure.
- Feature modules own their layers and local DI where the target adopts that
  layout. Root assembly composes modules and shared runtime. No forced global
  horizontal layout or mandatory `dto` subpackage.
  [Layout](../ddd-service-layout/SKILL.md), [assembly](../ddd-assembly/SKILL.md).
- Slices own input/result types and orchestration. A query does not mutate;
  credential checking that records lockout outcomes is a command even if its
  name sounds like a read. Foreign error outcomes conform to local port contracts, with explicit mapping where needed.
  [Use cases](../ddd-use-case/SKILL.md), [errors](../ddd-errors/SKILL.md).
- Domain decisions are pure. Policies consume integration DTOs and invoke the
  receiving module's use case. Durable multi-step processes define timeouts,
  idempotency, progress and compensation; engine code does not own invariants.
  [Policy](../ddd-policy/SKILL.md), [process manager](../ddd-process-manager/SKILL.md).

## Events, delivery and reads

- Domain facts and public integration DTOs are distinct; mapping plus outbox
  append shares the aggregate transaction, delivery happens after commit.
- Ordered records have immutable `(streamID, version)` identity. The next
  applicable record is exactly `lastVersion + 1`; already committed versions
  do nothing, and gaps do not advance state. No timestamp fallback.
- Rows/effects and the consumer's checkpoint commit atomically with concurrency
  protection. Separate streams have separate checkpoints. Multiple facts in a
  save are batched or separately sequenced; filtering does not conceal positions.
- Required unknown records are recovered through compatibility handling. Replay
  names a retained log or snapshot plus suffix; an outbox alone is insufficient.
  [Events](../ddd-domain-event/SKILL.md), [CQRS](../ddd-cqrs/SKILL.md).
- Queries return slice-owned DTOs, using the cheapest sufficient read model and
  documented freshness. Projector transactions are local and after producer
  commit. A command does not treat a stale projection as authoritative state.

## Edges, security and tests

- Cryptographic mechanisms are behind application ports where `auth.0016`
  applies; domain policy and opaque hashes stay inward. Plaintext does not enter
  aggregates, repositories, events or telemetry. Credential refusals remain
  indistinguishable across local contracts and public responses.
  [Security](../ddd-security/SKILL.md), [transport](../ddd-transport/SKILL.md).
- Application and policy tests use local port mocks in current auth. Backend
  tests live at infrastructure/platform/composition boundaries and prove rollback,
  conflict and outbox guarantees. Ordered consumers cover duplicates, gaps,
  concurrency and checkpoint rollback. Refused commands may intentionally emit
  protective effects such as revocation; assert the stated rule.
  [Testing](../ddd-testing/SKILL.md).
- Glossary, ADR and generated documentation references match current paths and
  behaviour. Follow project UI verification rules if generated output changed.

## Reporting

Order findings by impact, explain their layer and link the evidence. Quote the
relevant rule or scoped ADR, not just a preference. Report what was actually
inspected and any remaining uncertainty; do not imply a full service audit from
a narrow diff review.
