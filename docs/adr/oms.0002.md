# oms.0002 — An order is placed from a checked-out basket, not by a call

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [shop.oms](../shop/oms/README.md)
- **Source:** `examples/shop/oms/docs/adr/0002-an-order-is-placed-from-a-checked-out-basket.md`

### Context and Problem Statement

The hand-written model this service replaces had `PlaceOrder` on its API:
somebody called in with a basket snapshot and got an order. The cart, which
is real, ends its job with `BasketCheckedOut` and places nothing. Who starts
an order?

### Decision Outcome

The event does. A policy reacts to `BasketCheckedOut` off the bus and runs
`PlaceOrder`; there is no rpc for it, and `shop.v1.OrderService` has
`GetOrder` and `CancelOrder` only. The order takes the basket's id, and the
basket is unique in the store, so the same checkout heard twice - the relay
is at least once, and so is the bus - places one order and answers with it
the second time.

#### Consequences

- Good: one owner for "an order exists": the checkout. No client can place an
  order for a basket that was not checked out.
- Good: the first cross-service event hop in the estate is one a trace can
  show, `cart → bus → oms`.
- Bad: a checkout with an empty basket, or lines in a currency other than
  the total's, is refused here and nobody is told: the message is
  redelivered until it is not, which is a gap a dead-letter would close.
