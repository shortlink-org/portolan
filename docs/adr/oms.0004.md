# oms.0004 — Cancelling is allowed until the parcel moves

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [shop.oms](../shop/oms/README.md)
- **Source:** `examples/shop/oms/docs/adr/0004-cancel-is-allowed-until-dispatch.md`

### Context and Problem Statement

A customer may change their mind. Until when?

### Decision Outcome

Until the parcel moves. A placed or a confirmed order can be cancelled by
`CancelOrder`; a cancelled one answers the same call with the order as it is,
not an error. Once delivery says the shipment was dispatched the way back is
a return, which is delivery's business and not this service's: `CancelOrder`
will answer `FAILED_PRECONDITION` then. Nothing in the estate delivers yet,
so today every cancellation is before dispatch, and the table has no
`fulfilled` state to reach.

#### Consequences

- Good: the rule is one edge in the lifecycle table, and one status at the edge.
- Note: `OrderCancelled` carries a reason, because a consumer unwinds a
  customer's cancellation and a declined payment differently.
