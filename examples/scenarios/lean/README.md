# checkout — the saga, proved

A [Lean 4](https://lean-lang.org/) model of one checkout across OMS, ledger
and delivery: the order, its payment, the shipment, ledger's Authorize RPC, and
the facts on the bus between them. Any enabled step may come next, facts are
redelivered, RPC answers are lost, and every fact ledger says may be lost after
ledger saved what it says (ledger publishes after the save, with no outbox) —
and the properties below are checked against every interleaving, not a few.

The order is not modelled again: OMS's own model is required from
[`examples/shop/oms/lean`](../../shop/oms/lean/README.md) and every message the
order handles goes through its proved `Order.step`.

## What holds, in every reachable world

| Property | Theorem |
|---|---|
| A confirmed order has its money held or captured | `Checkout.confirmed_is_paid` |
| A declined payment never stands beside a confirmed order | `Checkout.declined_is_not_confirmed` |
| Once everything is delivered, captured money has released its shipment | `Checkout.captured_releases_shipment` |

All three follow from one invariant every action keeps (`Checkout.Inv`): an
authorization OMS has not heard yet is backed by a payment that was held, a
hold is given back only for a cancelled order, `OrderCancelled` is only said of
one, and captured money has released its shipment or a fact that will is still
on its way. Losing ledger's events breaks none of them.

The third held only after [ledger.0004](../../payments/ledger/docs/adr/0004-a-repeated-capture-says-payment-captured-again.md).
Before it, a capture whose `PaymentCaptured` did not leave was asked again and
answered without a word, and the shipment waited for good; the model found
that trace, `CapturePaymentTest` holds the code to it, and
`Checkout.lost_capture_is_said_again` shows the same trace now ending with the
shipment released.

The search also finds that no order is left placed once nothing more can
happen: a lost `PaymentAuthorized` or `PaymentDeclined` is recovered by the RPC
answer, or by OMS asking again and ledger answering from its record. That one is
searched, not proved: a repeated capture says its fact again, so the worlds do
not run out, and the search covers those within 40 steps.

## What does not hold

Each is pinned by a theorem on the trace that shows it. Both are gaps the
[checkout scenario](../README.md) already lists as unsolved.

**Cancellation racing authorization** — `Checkout.hold_left_on_cancelled_order`.
Ledger finds the order standing, the customer cancels, `OrderCancelled` reaches
ledger while there is no payment to void, and then the gateway holds. With
everything delivered, a cancelled order has money held that nothing will give
back.

**Cancellation after capture** — `Checkout.charge_left_on_cancelled_order`.
The order is confirmed, the customer cancels, delivery captures on the
`OrderConfirmed` it already had, the void that follows finds nothing held, and
`PaymentCaptured` releases the shipment. With everything delivered, a cancelled
order has been charged and its shipment is planned.

## Not modelled

Two Authorize calls for the same id at once; a gateway result lost before
ledger saves it; refunds; delivery past the release; more than one order.

## Layout

- `Checkout/Payment.lean` — ledger's `PaymentStatus` and its table.
- `Checkout/World.lean` — the world, the actions, `Reachable`.
- `Checkout/Invariants.lean` — the invariant, the three theorems that hold, the
  two traces that break, and the trace ledger.0004 fixed.
- `Checkout/Search.lean`, `Search.lean` — breadth-first search over every
  interleaving; prints, for each property, where it holds or the shortest trace
  that breaks it, preferring one in which ledger loses nothing.

## Running it

From this directory, with [elan](https://github.com/leanprover/elan) installed:

```bash
lake build
lake exe search
```

A build that passes is a proof that holds. The search is how a new property is
tried before it is proved: if it prints a trace, there is nothing to prove.
