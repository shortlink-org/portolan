# bff.0004 — A subscription is the bus, forwarded

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [storefront.bff](../storefront/bff/README.md)
- **Source:** `examples/bff/docs/adr/0004-subscriptions-are-the-bus-forwarded.md`

### Context and Problem Statement

A confirmation screen wants to know when the order it just caused comes into
being, and then when it is confirmed. The order service will not call this
one - nothing in the estate calls the storefront - so there are two ways to
answer `Subscription.orderStatus`: poll `GetOrder` on a timer, or listen to
the moves the order service already publishes for the ledger and delivery.

### Decision Outcome

Listen. One ephemeral JetStream consumer per subscribed client, filtered to
`shop.oms.order`, with the order id matched in this process; the moves are
mapped onto the schema's `OrderState` by the event's name, which rides as a
header, so nothing parses a payload to decide what it is.

Ephemeral, not durable: a client watching one order on one screen should
leave nothing behind on the server when it closes the tab, and a move it
missed while away is not worth replaying - the screen asks for `order` when
it opens.

The transport is server-sent events, which is what Yoga does by default. A
second protocol on a second port, for one field, would have to earn itself.

Without `NATS_URL` the port is filled by a stand-in that answers the
subscription and never yields, so a storefront running alone in a terminal
shows a screen that waits rather than a field that errors.

#### Consequences

- Good: no polling, and the storefront is a subscriber to `shop.oms.order`
  in the catalog like any other - the arrow is a fact, not a comment.
- Bad: a consumer per client is fine for a demo estate and would need a
  shared consumer with in-process fan-out before it was fine anywhere else.
- Note: this is the only reason the service touches the bus. It publishes
  nothing (bff.0002).
