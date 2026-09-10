---
name: ddd-policy
description: Place a pure domain decision or an event-driven reaction in the module that owns its outcome. Use for a rule outside one aggregate, or when one module reacts to another module's integration event.
---

# Domain service and policy

A domain service decides using local domain values; a policy reacts to a fact.
For a reaction that must remember several steps, deadlines or compensations,
use [ddd-process-manager](../ddd-process-manager/SKILL.md).

## Domain service

Keep the decision pure. Pass the relevant aggregate instances, local values
and explicit times; no repository, client or clock is called inside it.
Aggregates do not import the service that reasons about them. Do not import a
foreign module's aggregate to make a decision: translate required facts to
local values through a consumer-owned port.

Choose time by meaning. A credential change's occurred-at determines which
sessions predate it; an explicit current time can determine which sessions
are still live. Do not substitute processing time for business occurrence time.

## Policy

- Own the reaction in the module whose state changes. In current auth it is
  `session/infrastructure/messaging/policy`, following `auth.0012` and `auth.0013`.
- Consume the producer's public integration-event DTO, not its domain event
  or root. Translate it to the receiving use case's command.
- Call a use case through a small consumer-owned interface; never bypass its
  rules by writing the repository. Inject that interface in local DI.
- Subscribe in assembly. An unrelated event is outside a type-specific
  policy's scope; decoding a malformed supported event must fail delivery.
- Keep reactions idempotent under redelivery. If they depend on event order,
  enforce the stream's strict version progression before applying them; see
  [ddd-domain-event](../ddd-domain-event/SKILL.md).

A rule caused by every password change belongs behind the event, so new ways
to change a password inherit it. A synchronous need such as credential checking
is a port on the caller, implemented by a cross-module adapter, not a policy.

## Checklist

- Decision uses local values and explicit time, without I/O.
- Reaction is owned by the affected module and consumes an integration contract.
- Policy calls an injected use case, not a repository.
- Assembly owns subscriptions; retries cannot repeat the business effect.
- Multi-step durable progress routes to a process manager.

Current Go reference: [references/go.md](references/go.md).
