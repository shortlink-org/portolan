---
name: ddd-assembly
description: Wire module-local dependencies, integration-event subscriptions and service-wide resources. Use when binding ports, adding a module or policy, or changing how an assembled service starts and closes resources.
---

# Assembly

Follow the target's accepted layout. In auth (`auth.0012`), each feature owns
its local Wire sets; the root composes those sets and shared resources.

## Rules

- Split module providers by concern: application, infrastructure, HTTP, policy.
  Bind a concrete adapter to each small consumer-owned port it satisfies.
- Cross-module adapters belong to the consuming module's infrastructure.
  Local DI introduces them; do not put their translation behaviour in the
  root. Domain and application do not import peer modules.
- Subscribe policies to integration-event names in assembly. The policy
  implements a reaction, not registration. Bind projectors beside policies,
  preserving their ordered delivery contract.
- Register every outbox topic for delivery, including topics without local
  policies. Document intentional absence of subscribers. Outbox, driver and
  cache must share the same transaction lookup.
- Expose opened resources and background workers through the assembled app;
  lifecycle belongs to the owner that starts and closes them. Include startup
  failure cleanup and orderly relay shutdown.
- Configure optional external services explicitly. Auth has `RISK_ENABLED`
  and `RISK_ADDR` compatibility behaviour; enabled-but-unreachable risk fails
  closed. Do not introduce branches in a use case for deployment configuration.
- A Temporal worker or another durable-process runner is an infrastructure
  dependency wired here when chosen, not a domain dependency. See
  [ddd-process-manager](../ddd-process-manager/SKILL.md).

## Checklist

- Module DI owns local bindings; root DI composes modules and shared runtime.
- Integration adapters translate at the consuming boundary.
- Topics, policies and projectors are registered deliberately.
- Transaction lookup and resource lifecycle are verified by focused integration tests.
- No inward package imports DI.

Current Go paths: [references/go.md](references/go.md).
