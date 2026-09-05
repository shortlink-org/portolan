# bff.0002 — The storefront owns no state

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [storefront.bff](../storefront/bff/README.md)
- **Source:** `examples/bff/docs/adr/0002-the-storefront-owns-no-state.md`

### Context and Problem Statement

Every other service in the estate has an aggregate and a database. This one
is asked for a basket and an order it did not create and cannot change on its
own. The obvious next step - a table of "storefront sessions", a cache of
baskets, a copy of the order for the screen - is the step that turns a
composition layer into a service with a domain, and then into a second writer
of somebody else's facts.

### Decision Outcome

No aggregate, no store, no outbox, no event of its own.

The service holds ports and adapters and nothing else. A resolver reaches a
peer and translates the answer; that is the whole of the code between the
schema and the clients. Two things follow, and both are deliberate:

- **There is no `login` and no password anywhere in this tree.** Sessions are
  minted by auth and nowhere else, and this service asks auth on every
  request rather than reading a token it holds no key for.
- **A refusal belongs to whoever refused.** The cart decides whether a basket
  may be changed and the order service whether an order may be cancelled;
  their answers travel back unchanged. The only error this service invents is
  `PeerError`, which says that a peer did not answer at all.

#### Consequences

- Good: nothing here can drift from the estate, because there is nothing here
  to drift.
- Good: the catalog shows the service as what it is - one that provides an
  interface, consumes four, and owns no store.
- Bad: every screen costs a fan-out; there is no cache to answer from and
  adding one would need this decision revisited, not just a library.
