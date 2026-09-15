# ledger.0004 — A repeated capture says PaymentCaptured again

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** [payments.ledger](../payments/ledger/README.md)
- **Source:** [`examples/payments/ledger/docs/adr/0004-a-repeated-capture-says-payment-captured-again.md`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/docs/adr/0004-a-repeated-capture-says-payment-captured-again.md)
- **Committed:** Victor Login, 2026-09-15 (`6f7c2b0`)

### Context and Problem Statement

What does a capture of a payment that is already captured say on the bus?

`CapturePayment` saves the captured payment and then publishes
`PaymentCaptured`. The two are not one transaction: the service has no outbox,
and `NatsBus.publish` throws after the row is written. The caller - delivery,
asking on `OrderConfirmed` - gets an error, keeps the fact and asks again. The
second capture found the payment captured and answered with the first capture,
saying nothing. Delivery took that answer as done, and its shipment, which is
released only by `PaymentCaptured` (delivery core.0002), waited in
`awaiting-payment` with the money already moved and no fact left to come.

The checkout model in `examples/scenarios/lean` found this as the shortest
trace breaking "once all is delivered, money captured has released its
shipment"; at-least-once redelivery could not recover it.

### Decision Drivers

- Money that moved must, eventually, be said to have moved: everything owed
  something for the order waits for that fact and nothing earlier.
- A repeated capture must not move money twice.
- The fix should hold without a new moving part in a service that is a sketch.

### Considered Options

1. **An outbox** — the event is stored in the transaction that captures and a
   relay publishes it; the save and the saying cannot come apart.
2. **Say it again on a repeated capture** — a capture of a captured payment
   moves nothing and publishes the same `PaymentCaptured`, with the time of the
   first capture.
3. **Delivery releases on the capture's answer** — the RPC reply counts as the
   fact.

### Decision Outcome

Chosen option: **say it again on a repeated capture**.

| | money moves twice | fact can be lost for good | cost |
|---|---|---|---|
| outbox | no | no | a table, a relay, a migration |
| say it again | no | only if nobody asks again | a branch in the use case |
| release on the answer | no | yes, for any other listener | a second path to the release |

A lost `PaymentCaptured` leaves the capture call failed, and a failed call is
asked again by whoever needs the fact, so the repeat is where it can be said
again. The payment is not changed and no posting is written; `Payment` hands
back the same fact through `capturedAgain`, which refuses a payment that is not
captured. Option 3 is rejected because the release hangs off the fact so that
money arriving any other way releases the same (core.0002), and it would fix
delivery only. Option 1 remains the fix for every event this service says, and
supersedes this one when it lands.

#### Consequences

- Good: the model's invariant holds — once everything is delivered, captured
  money has released its shipment — and `CapturePaymentTest` holds the code to
  the trace.
- Good: nothing moves twice; the gateway is asked once.
- Bad: consumers see `PaymentCaptured` more than once for one capture, not only
  through redelivery. Delivery's `release_shipment` now leaves a shipment that
  is out of the waiting room alone instead of refusing, which the bus would
  otherwise redeliver without end.
- Neutral: a `PaymentAuthorized` or `PaymentDeclined` that does not leave is
  still recovered by the order service's RPC answer or its retry, as before.
