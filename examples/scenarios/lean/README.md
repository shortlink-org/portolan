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
| Once everything is delivered, a cancelled order holds no money | `Checkout.cancelled_holds_nothing` |
| Once everything is delivered, a cancelled order whose money was captured has had it sent back | `Checkout.cancelled_charge_is_refunded` |

All five follow from one invariant every action keeps (`Checkout.Inv`): an
authorization OMS has not heard yet is backed by a payment that was held, a
hold is given back only for a cancelled order, `OrderCancelled` is only said of
one, captured money has released its shipment or a fact that will is still on
its way, and a hold beside a cancelled order still has `OrderCancelled` or
ledger's second look at the order coming, and a capture beside a cancelled
order has been sent back or `OrderCancelled` is still on its way to ledger.
Losing ledger's events breaks none of them.

The third held only after [ledger.0004](../../payments/ledger/docs/adr/0004-a-repeated-capture-says-payment-captured-again.md).
Before it, a capture whose `PaymentCaptured` did not leave was asked again and
answered without a word, and the shipment waited for good; the model found
that trace, `CapturePaymentTest` holds the code to it, and
`Checkout.lost_capture_is_said_again` shows the same trace now ending with the
shipment released.

The fourth held only after [ledger.0005](../../payments/ledger/docs/adr/0005-a-hold-is-recorded-before-the-order-is-asked-again.md).
Before it, a cancellation that reached ledger while the gateway was holding
found no payment to give back, and the hold stayed; ledger now records the hold
and asks about the order again. `AuthorizePaymentTest` holds the code to that
trace, and `Checkout.cancel_racing_hold_gives_it_back` shows it now ending with
the hold given back.

The fifth held only after [ledger.0006](../../payments/ledger/docs/adr/0006-a-cancelled-order-gets-its-captured-money-back.md).
Before it, an order confirmed, cancelled and then captured on the
`OrderConfirmed` delivery already had was charged for good: the void that
followed found nothing held. `OrderCancelled` now sends the capture back as a
refund; `RefundCancelledOrderTest` holds the code to that trace, and
`Checkout.charge_on_cancelled_order_is_sent_back` shows it now ending refunded.

The search also finds that no order is left placed once nothing more can
happen: a lost `PaymentAuthorized` or `PaymentDeclined` is recovered by the RPC
answer, or by OMS asking again and ledger answering from its record. That one is
searched, not proved: a repeated capture says its fact again, so the worlds do
not run out, and the search covers those within 40 steps.

## Not modelled

Two Authorize calls for the same id at once; a gateway result lost before
ledger saves it; ledger stopping between recording a hold and asking about the
order again, or the gateway not answering the give-back (ledger.0005 names both);
a gateway refusing a refund; delivery past the release, so a cancelled
order's released shipment is left as it is here, where delivery writes it off
when dispatch asks the order; more than one order.

## Layout

- `Checkout/Payment.lean` — ledger's `PaymentStatus` and its table.
- `Checkout/World.lean` — the world, the actions, `Reachable`.
- `Checkout/Invariants.lean` — the invariant, the five theorems that hold, and
  the traces ledger.0004, ledger.0005 and ledger.0006 fixed.
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
