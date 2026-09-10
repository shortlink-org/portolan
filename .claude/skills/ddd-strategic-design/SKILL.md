---
name: ddd-strategic-design
description: Discover subdomains, bounded contexts, ownership and context relationships before choosing services or aggregates. Use for a new business capability, ambiguous model boundaries, or a proposed split or merger of contexts.
---

# Strategic design

Start with business scenarios and decisions, then choose model boundaries.
A bounded context is a boundary of language and model consistency; it need
not be a separately deployed microservice. Several contexts can live in a
modular monolith, and deployment alone does not establish a context.

## Discover the problem

Read existing glossaries, context maps, ownership records and accepted ADRs.
Identify actors, domain experts, commands, facts and exceptional outcomes in
representative scenarios. Use an event-storming-style timeline when the flow
is unclear; do not require a workshop for a small change. Mark assumptions
and unresolved business questions instead of inventing policy.

Classify subdomains by their role in this business: core differentiation,
supporting capability, or generic capability. Explain the classification;
use it to decide where custom modelling is worth the cost. A generic CRUD
capability does not automatically need aggregates, CQRS or a new service.

## Propose boundaries

Group concepts that share meanings, invariants and ownership. Look for words
whose meaning changes across teams or workflows. Give each candidate context:

- responsibility, deliberate exclusions and accountable owner;
- local terms and the facts it alone can change;
- representative scenarios and the invariants they require;
- imported facts, required freshness and behaviour when a peer is unavailable.

Do not split by database table, endpoint or technical layer. Assess a proposed
split against cross-boundary coordination and translation costs; assess a
merger against competing meanings and independent ownership. Record the
credible alternative, not only the preferred boundary.

## Draw the context map

For each relationship name upstream/downstream, the supplied fact or service,
the contract owner, translation and compatibility responsibility, and the
consistency/failure expectation. Choose the relationship intentionally:
customer/supplier, partnership, conformist, anti-corruption layer, open host
service/published language, shared kernel, or separate ways. A shared kernel
requires explicit joint ownership and coordinated change; it is not a generic
shared models package.

Translate foreign concepts in the consuming adapter. Carry identifiers and
contract DTOs, not another context's aggregate objects. The same real-world
person may have different models and names in different contexts.

## Deliver and continue

Produce a concise context map and ownership table in the existing architecture
documentation, glossary changes, and an ADR for material boundary decisions.
Distinguish agreed facts from assumptions. Reuse LikeC4 when the project already
models contexts; verify the generated diagram if it changes.

Then use [ddd-aggregate](../ddd-aggregate/SKILL.md) to derive consistency
boundaries and [ddd-new-service](../ddd-new-service/SKILL.md) for implementation.
For an existing context, revisit only the boundary affected by the request.

## Checklist

- Business scenarios and owners justify the boundaries.
- Core/supporting/generic classification explains investment choices.
- Context identity is separate from deployment topology.
- Each shared fact has an owner and an explicit integration relationship.
- Glossary, map and ADR agree; uncertainty remains visible.
