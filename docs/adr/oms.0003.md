# oms.0003 — Lines and the total are copied from the basket, never repriced

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [shop.oms](../shop/oms/README.md)
- **Source:** `examples/shop/oms/docs/adr/0003-lines-are-copied-never-repriced.md`

### Context and Problem Statement

`BasketCheckedOut` carries the lines at the prices they were added at and the
total the cart took from pricing at checkout. Does the order take those, or
ask pricing again?

### Decision Outcome

It takes them. The customer agreed to this number at checkout, and an order
that recomputed it could differ from what was agreed by the time the money
moved. The order holds no price list and calls no pricing; it checks only
that there is at least one line and that every line's currency is the
total's. Everything else about the numbers is the cart's and pricing's.

#### Consequences

- Good: the order is a record of an agreement, and reads like one.
- Bad: a basket priced wrongly is an order priced wrongly; the fix is upstream.
