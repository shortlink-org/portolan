---
name: ddd-service-layout
description: Place modules and packages in a service with inward dependencies, following its accepted ADRs. Use when creating a service, adding a capability, or reviewing boundaries between domain, application, infrastructure, integration contracts and assembly.
---

# Service layout

Read the target service's README, accepted ADRs and dependency rules before
choosing paths. Follow the architecture accepted for that context; an example
from another context does not override it. If a requested change reverses a
recorded decision, explain the trade-off and record its replacement with
[ddd-adr](../ddd-adr/SKILL.md). Do not restore an older layout to satisfy a
stale example in a skill.

For new services, establish context ownership with
[ddd-strategic-design](../ddd-strategic-design/SKILL.md) first. The current Go
reference is `examples/auth`, especially `auth.0012` through `auth.0016`.

## Module boundaries

Auth uses vertical feature modules (`user`, `session`, `lockout`). Each owns:

| Part | Responsibility and allowed knowledge |
|---|---|
| `domain` | its own invariants, aggregates, value objects and domain events; no peer module or infrastructure |
| `application` | use case slices and consumer-owned ports; its own domain and application |
| `infrastructure` | repositories, clients, HTTP handlers, event consumers; implements ports and translates peer contracts |
| `integration` | public event DTOs and explicit mapping at the outbox boundary |
| `di` | local bindings and subscriptions; composed by the service root |

Shared runtime mechanics belong in `platform`; the generated HTTP server and
root composition stay service-wide. Business behaviour stays with the module
that owns the state it changes. An adapter may know both sides; domain and
application packages may not import another module. Domain services stay pure
and accept local domain values; translate foreign facts at the boundary.

## Placing work

- An aggregate is a consistency boundary justified by its invariants, not a
  directory rule: [ddd-aggregate](../ddd-aggregate/SKILL.md).
- Each use case is a slice under its module's `application`. Input/output
  types belong to the slice (`Command`, `Query`, `Result` in auth); a separate
  `dto` subpackage is not required.
- A port belongs to its consumer. An infrastructure adapter may satisfy
  several small compatible ports; do not duplicate it solely to enforce a
  one-port-per-adapter rule.
- Cross-module clients live in the consuming module's infrastructure, with
  wiring in local DI. Event-driven policies live with the affected module,
  under its messaging infrastructure in auth; see
  [ddd-policy](../ddd-policy/SKILL.md).
- Readers and projectors live in the owning module's infrastructure. Long
  processes follow [ddd-process-manager](../ddd-process-manager/SKILL.md).

## Documentation and checks

The service README states ownership, deliberate omissions and module layout.
Keep one `GLOSSARY.md` per context. Domain READMEs explain invariants and
lifecycle; use case READMEs explain steps, answers and derived flow links.
Use the repository's ADR location and naming rather than moving existing records.

Check the target's executable dependency rules. Auth uses `depguard` in
`.golangci.yml`; application tests use local mocks and infrastructure tests
own their backends. Review only the boundaries affected by the task.

Go paths and reference decisions: [references/go.md](references/go.md).
