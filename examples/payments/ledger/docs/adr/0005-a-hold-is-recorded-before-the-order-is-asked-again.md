# ledger.0005 — A hold is recorded before the order is asked about again

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** payments.ledger

## Context and Problem Statement

What gives back a hold the gateway made for an order that was cancelled while
it was holding?

`AuthorizePayment` asks the order service whether the order stands, then asks
the gateway to hold, then records the hold. `VoidPaymentOnOrderCancelled` gives
back whatever hold is on record when `OrderCancelled` arrives. Between the
first question and the record there is nothing on record: a customer who
cancels in that window has the fact reach this service, find no payment, and
release nothing. The hold is then recorded, the order service ignores the
authorization for a cancelled order, and nobody gives the money back.

The checkout model in `examples/scenarios/lean` found this as the shortest
trace breaking "once all is delivered, a cancelled order holds no money"; the
checkout scenario listed it as unsolved.

## Decision Drivers

- A cancelled order must not keep a customer's money held.
- The order service is where cancellation is decided; the ledger asks it and
  does not keep its own copy.
- The fix should need no new table and no new moving part in a sketch.

## Considered Options

1. **Ask the order again after recording the hold** — record the hold, ask
   whether the order still stands, and give the hold back here if it does not.
2. **Remember cancellations** — `OrderCancelled` with no payment on record
   writes a marker, and authorizing checks for it.
3. **Leave it to a reconciliation sweep** — a job gives back holds on
   cancelled orders later.

## Decision Outcome

Chosen option: **ask the order again after recording the hold**.

| | closes the window | new state | cost |
|---|---|---|---|
| ask again after the record | yes, while the service stays up | none | one more call to the order service |
| remember cancellations | yes, with the marker and the record serialized | a marker per order, and no amount to key it on | a table and a race of its own |
| sweep | eventually | a job | a scheduler and a query |

The order of the two steps is the whole decision. Once the hold is on record,
any `OrderCancelled` that arrives finds it and gives it back. Any cancellation
before the record has already been committed by the order service, because
the fact is published after the commit, so the second question sees it. There
is no cancellation left that neither the question nor the policy meets. A hold
given back here is recorded as voided, `PaymentAuthorized` is not said, and
the caller hears `ORDER_CANCELLED`; asking again for the same payment answers
the same from the record.

Option 2 is rejected because a marker and a payment written by two
transactions need an ordering between them that the model shows is easy to get
wrong, and the marker would carry an order with no amount. Option 3 is the way
to recover what this decision leaves open, below.

### Consequences

- Good: the model proves "once all is delivered, a cancelled order holds no
  money" for every reachable world, and `AuthorizePaymentTest` holds the code
  to the trace.
- Good: a cancelled order is no longer told `PaymentAuthorized` for a hold that
  is already gone.
- Bad: a process that stops between recording the hold and asking again, or a
  gateway that does not answer the give-back, leaves the hold on record and
  nobody to ask about it: the order service does not retry a cancelled order.
  That is the same class of window ledger.0001 leaves after the gateway
  holds, and a sweep over authorized payments of cancelled orders closes both.
- Neutral: a standing order costs one more call to the order service on the
  way to `PaymentAuthorized`.
