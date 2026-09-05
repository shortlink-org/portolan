# cart.0006 — Abandonment is a sweep inside the service, and it publishes

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** [shop.cart](../shop/cart/README.md)
- **Source:** `examples/shop/cart/docs/adr/0006-abandonment-is-a-sweep-that-publishes.md`

### Context and Problem Statement

A basket untouched for a day is abandoned. `auth` lets a session expire with
nothing running and no event, on the grounds that nobody decided anything.
Is a basket the same?

### Decision Outcome

No. An abandoned basket is a question somebody asks - what do customers leave
behind, and why - so abandonment is decided, recorded and published. A sweep
runs inside the service once a minute, marks every open basket untouched for
24 hours as `abandoned`, and publishes `BasketAbandoned` for each, through
the outbox like any other event. The sweep is a use case, `ExpireIdleBaskets`;
what is unusual is only that nothing calls it from outside.

#### Consequences

- Good: abandonment has one author and one timestamp, and a consumer can
  react to it.
- Bad: a sweep is a second process inside the service, alongside the relay,
  and has to be shut down with it.
- Note: the catalog reads no flow for the sweep, because no endpoint or
  event opens it; the operation is in the model, the sequence is not.
