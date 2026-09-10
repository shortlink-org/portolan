# auth.0013 — Domain events become integration events at the transactional outbox boundary

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-07
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** [`examples/auth/docs/adr/0013-domain-events-become-integration-events-at-the-outbox.md`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/docs/adr/0013-domain-events-become-integration-events-at-the-outbox.md)
- **Committed:** Victor Login, 2026-09-07 (`34b9b7c`)

### Context and Problem Statement

An immutable event useful inside an aggregate is not automatically a stable
contract for policies or another service. At the same time, saving state and
announcing its change must not split into two independent commits.

### Decision Outcome

Each module defines two event representations:

- `domain/event` contains immutable facts returned by aggregate operations;
- `integration/event` contains public-field DTOs, JSON metadata, stable names,
  and the mapping to and from outbox messages.

The repository accepts domain events alongside the changed aggregate. Inside
one unit of work it stores the aggregate, maps those events to integration
DTOs, and appends the messages to the outbox. The database router and outbox
publisher resolve the same transaction from context. Publishing without a
unit of work is refused.

After commit, the relay reads every module topic and publishes integration
events to typed module buses. Policies subscribe to those DTOs and do not
import aggregate event types. Unknown event names are acknowledged so a newer
producer cannot permanently block an older relay; malformed known payloads
fail delivery.

#### Consequences

- Good: state and its durable fact commit or roll back together.
- Good: domain events stay immutable and free of serialization concerns.
- Good: integration payloads can be versioned without changing aggregates.
- Bad: each published event needs an explicit mapping and round-trip test.
- Neutral: the outbox is at-least-once; consumers must remain idempotent.
