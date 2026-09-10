---
name: ddd-new-service
description: Implement a new service, module or aggregate using the target's accepted architecture and the relevant DDD skills. Use for end-to-end capability work after establishing business ownership and context boundaries.
---

# New service or capability

Read the target README, accepted ADRs and dependency checks first. Follow
[ddd-service-layout](../ddd-service-layout/SKILL.md); do not copy an obsolete
layout from a reference. Current auth uses feature modules, local DI,
integration-event DTOs, application cryptographic ports and package-local mocks
(`auth.0012`–`auth.0016`). These are reference decisions, not a reason to
restructure an unrelated context.

## Before implementation

1. Establish responsibility and exclusions. For a new or disputed boundary use
   [ddd-strategic-design](../ddd-strategic-design/SKILL.md): scenarios, domain
   experts, subdomain role, context ownership and relationships. A new capability
   may fit an existing module; do not assume a new microservice.
2. State immediate business invariants and concurrent scenarios. Derive aggregates
   from those consistency requirements with [ddd-aggregate](../ddd-aggregate/SKILL.md),
   then assess size and contention. Document eventual consistency and repair
   wherever a rule spans boundaries.
3. Add local terms to the context's [glossary](../ddd-ubiquitous-language/SKILL.md).
   Record consequential alternatives with [ddd-adr](../ddd-adr/SKILL.md).

## Implementation order

| Work | Guidance |
|---|---|
| Domain values, rules and aggregate operations | [value objects](../ddd-value-object/SKILL.md), [specifications](../ddd-specification/SKILL.md), [aggregate](../ddd-aggregate/SKILL.md), [lifecycle](../ddd-state-machine/SKILL.md) |
| Domain facts, public integration DTOs and ordered stream contract | [events](../ddd-domain-event/SKILL.md); schema version and stream position are distinct |
| Slice-owned commands/queries, results, ports and error outcomes | [use cases](../ddd-use-case/SKILL.md), [errors](../ddd-errors/SKILL.md), [CQRS](../ddd-cqrs/SKILL.md) |
| Pure decisions and independent event reactions | [policy](../ddd-policy/SKILL.md) |
| Multi-step progress, deadlines or compensation, when required | [process manager](../ddd-process-manager/SKILL.md), including Temporal as an option |
| Stores, migrations, transactional event mapping/outbox, peer adapters | [unit of work](../ddd-unit-of-work/SKILL.md), [adapters](../ddd-adapters/SKILL.md) |
| HTTP/RPC and credentials where relevant | [transport](../ddd-transport/SKILL.md), [security](../ddd-security/SKILL.md) |
| Module DI, root composition and background workers | [assembly](../ddd-assembly/SKILL.md) |
| Tracing and derived documentation | [observability](../ddd-observability/SKILL.md), [language/model](../ddd-ubiquitous-language/SKILL.md) |

Write tests with the behaviour they cover; run focused checks together after
implementation, following [ddd-testing](../ddd-testing/SKILL.md). In auth,
application/policy tests use local mocks; infrastructure and composition tests
verify real persistence and outbox guarantees. A recording bus is not proof of
transactional publication.

## Existing service changes

For a new aggregate, implement only the needed domain, slices, adapters and
local wiring. A peer need is a consumer-owned port, translated in the consuming
module's infrastructure. For a new query, choose the cheapest adequate read
model; no event or projector is required merely because it is a query.

An ordered projection must specify strict version + 1, atomic rows/checkpoint,
duplicate and gap handling, and retained history or snapshot bootstrap before
being described as replayable. Current auth's integration events do not yet
supply this ordered envelope; do not claim that they do.

## Done when

- Applicable invariants, accepted ADRs and dependency rules are satisfied.
- Relevant layer tests have passed; skipped checks are reported accurately.
- New terminology and consequential decisions are recorded.
- If catalog/diagram output changed, generation and the actual rendered region
  are verified under the project's AGENTS.md.
- [ddd-review](../ddd-review/SKILL.md) checks the affected scope.
