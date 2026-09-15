# checkout — the saga, proved

A [Lean 4](https://lean-lang.org/) model of one checkout across OMS, ledger
and delivery: the order, its payment, ledger's Authorize RPC, and the facts on
the bus between them. Any enabled step may come next, facts are redelivered,
answers are lost — and the properties below are checked against every
interleaving, not a few.

The order is not modelled again: OMS's own model is required from
[`examples/shop/oms/lean`](../../shop/oms/lean/README.md) and every message the
order handles goes through its proved `Order.step`.

## What holds, in every reachable world

| Property | Theorem |
|---|---|
| A confirmed order has its money held or captured | `Checkout.confirmed_is_paid` |
| A declined payment never stands beside a confirmed order | `Checkout.declined_is_not_confirmed` |

Both follow from one invariant every action keeps (`Checkout.Inv`): an
authorization OMS has not heard yet is backed by a payment that was held, a
hold is given back only for a cancelled order, and `OrderCancelled` is only
said of one.

## What does not hold

Both are gaps the [checkout scenario](../README.md) already lists as unsolved;
the model turns each into the shortest trace that shows it, and a theorem pins
that trace.

**Cancellation racing authorization** — `Checkout.hold_left_on_cancelled_order`.
Ledger finds the order standing, the customer cancels, `OrderCancelled` reaches
ledger while there is no payment to void, and then the gateway holds. With
everything delivered, a cancelled order has money held that nothing will give
back.

**Cancellation after capture** — `Checkout.charge_left_on_cancelled_order`.
The order is confirmed, the customer cancels, delivery captures on the
`OrderConfirmed` it already had, and the void that follows finds nothing held.
With everything delivered, a cancelled order has been charged.

## Not modelled

Two Authorize calls for the same id at once; a gateway result lost before
ledger saves it; a ledger publication lost after the save (ledger has no
outbox); refunds; more than one order.

## Layout

- `Checkout/Payment.lean` — ledger's `PaymentStatus` and its table.
- `Checkout/World.lean` — the world, the actions, `Reachable`.
- `Checkout/Invariants.lean` — the invariant, the two theorems that hold, the
  two traces that break.
- `Checkout/Search.lean`, `Search.lean` — breadth-first search over every
  interleaving; prints, for each property, where it holds or the shortest trace
  that breaks it.

## Running it

From this directory, with [elan](https://github.com/leanprover/elan) installed:

```bash
lake build
lake exe search
```

A build that passes is a proof that holds. The search is how a new property is
tried before it is proved: if it prints a trace, there is nothing to prove.
