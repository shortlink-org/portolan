# oms.0007 — A declined payment cancels the order

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** [shop.oms](../shop/oms/README.md)
- **Source:** [`examples/shop/oms/docs/adr/0007-a-declined-payment-cancels-the-order.md`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/docs/adr/0007-a-declined-payment-cancels-the-order.md)
- **Note:** Replaces the paragraph of oms.0006 that left a declined order placed; the rest of oms.0006 stands.

### Context and Problem Statement

oms.0006 acknowledges a confirmed decline and leaves the order placed, "for an
explicit cancellation or a future payment-retry decision". Nobody makes that
decision: nothing in the estate asks the customer for another card, and an
order that is placed forever holds its basket's lines and reads as waiting for
money that is not coming. What happens to an order whose payment is declined?

### Decision Drivers

- An order ends in a state that says what happened to it.
- A decline arrives twice - the Authorize answer and `ledger.PaymentDeclined` -
  and redelivery of either must change the order once.
- A late decline must not undo a confirmation, as a late authorization must not
  resurrect a cancellation.
- One payment id per checkout (oms.0006) is kept.

### Considered Options

1. **Leave it placed** — what oms.0006 did; a later retry or a person decides.
2. **Cancel the order** — the decline is final for this checkout; the customer
   checks out again to pay with something else.
3. **Retry the payment** — a new attempt with a new payment id, bounded, then cancel.

### Decision Outcome

Chosen option: **cancel the order**.

| | order state | payment ids | what it needs |
|---|---|---|---|
| leave it placed | open, indefinitely | one | a decision nobody owns |
| cancel | cancelled, with the reason | one | a policy over the existing cancel |
| retry | placed, then either | many per checkout | attempt numbering, a timeout, a process manager |

Both paths reach the same `cancel_order` use case: `RequestPaymentOnOrderPlaced`
with a declined answer, and `CancelOrderOnPaymentDeclined` with the ledger's
fact. The cancellation applies only to a placed order whose id is the payment
id; a confirmed order stays confirmed and a cancelled one changes nothing, so
the second delivery is a no-op. The reason on `OrderCancelled` names the
ledger's closed decline reason. `ORDER_CANCELLED` means the order was already
cancelled when ledger read it, and the same rule makes it a no-op.

What is given up is the customer's second chance inside one order: a refused
card ends the checkout, and paying another way is a new basket. That is the
cheaper loss while nothing can ask the customer anything; option 3 supersedes
this one when something can.

### Consequences

- Good: every order leaves `placed` - confirmed by an authorization, cancelled
  by a decline or the customer.
- Good: consumers of `OrderCancelled` already tell a customer's cancellation
  from a declined payment by its reason (oms.0004).
- Bad: a decline caused by a mistake at ledger cancels a checkout that could
  have been paid; ledger's closed reasons and its outage-is-not-a-decline rule
  are what keep that rare.
- Bad: a decline racing a confirmation for the same payment id is resolved by
  whichever commits first. One payment id per checkout makes that a ledger
  inconsistency, not a normal path.

## Relates to

- **Events:** [`payments.ledger.payment.PaymentDeclined`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentdeclined), [`shop.oms.order.OrderCancelled`](../shop/oms/aggregates/order.md#event-shop-oms-order-ordercancelled)
