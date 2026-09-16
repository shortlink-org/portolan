# ledger.0006 — A cancelled order gets its captured money back

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** [payments.ledger](../payments/ledger/README.md)
- **Source:** [`examples/payments/ledger/docs/adr/0006-a-cancelled-order-gets-its-captured-money-back.md`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/docs/adr/0006-a-cancelled-order-gets-its-captured-money-back.md)
- **Committed:** Victor Login, 2026-09-16 (`5c37cb6`)

### Context and Problem Statement

What happens to money already captured for an order the customer cancels?

A customer may cancel until the parcel moves (oms.0004). The money moves
earlier: delivery asks for the capture when it creates the shipment, on
`OrderConfirmed` (core.0003). So a confirmed order can be cancelled with its
payment captured. `VoidPaymentOnOrderCancelled` gives back only a hold, and
for a captured payment answered "nothing released": the order was cancelled
and the customer stayed charged. The shipment does not leave - delivery asks
the order again at dispatch and writes a cancelled order's shipment off - but
nothing sent the money back.

The checkout model in `examples/scenarios/lean` found this as the shortest
trace breaking "once all is delivered, a cancelled order has not been
charged"; the checkout scenario listed it as unsolved.

### Decision Drivers

- The order service decides cancellation; a cancelled order is not charged.
- Money that moved comes back as a refund, the aggregate that already says
  so, never by rewriting the payment.
- The fact arrives at least once: nothing goes back twice.

### Considered Options

1. **Refund on the cancellation** — a second policy on `OrderCancelled` sends
   back whatever is left of a capture, as one refund per cancelled order.
2. **Capture at dispatch instead** — the money moves only when the parcel
   does, so a cancellation always finds a hold.
3. **Refuse to cancel a captured order** — the order service asks the ledger
   before cancelling.

### Decision Outcome

Chosen option: **refund on the cancellation**.

| | customer charged for a cancelled order | changes elsewhere | cost |
|---|---|---|---|
| refund on the cancellation | no, once the fact is delivered | none | a use case and a policy |
| capture at dispatch | no | delivery's release rule (core.0002, core.0003) | a hold that may expire before dispatch |
| refuse to cancel | no, and the customer cannot cancel | oms.0004 and a call from OMS to ledger | a rule customers see |

`RefundCancelledOrder` finds the order's payment, and when it is captured
issues a refund of what is left of the capture after earlier refunds, under
the id `order-cancelled-<order id>`. The same fact again answers from that
refund's record; a capture already given back in full sends nothing. A hold
is still `VoidPayment`'s: a payment is held or captured, never both, so the
two policies on the fact never meet. Option 2 reverses two delivery decisions
and trades this problem for an expiring hold; option 3 takes away a choice
oms.0004 gives the customer.

#### Consequences

- Good: the model proves "once all is delivered, a cancelled order whose money
  was captured has had it sent back" for every reachable world, and
  `RefundCancelledOrderTest` holds the code to the trace.
- Good: the refund says `RefundIssued` with the cancellation's reason, so
  whoever reconciles a cancelled order sees the money come back.
- Bad: a gateway that refuses the refund leaves it `REJECTED`, and the fact
  arriving again answers from that record: money a gateway would not take back
  needs a person, as any other rejected refund does.
- Neutral: delivery is unchanged. A released shipment of a cancelled order
  waits until dispatch asks the order and writes it off.
