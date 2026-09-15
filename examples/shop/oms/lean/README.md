# oms — the order, proved

A model of the order in [Lean 4](https://lean-lang.org/): its lifecycle, how
it is placed, and how it answers the messages that reach it. Rules the Rust
tests check on examples are proved here for every input — every basket, every
sequence of messages, in any order and with any repeats.

The model is not the code. It keeps what the rules depend on (id, lines, total,
status) and leaves out what they do not (customer, basket, clock, version).
[`tests/lean_scenarios.rs`](../tests/lean_scenarios.rs) ties the two: it runs
what the model computes through the real use cases.

## What is proved

| Rule | Theorem | Where it comes from |
|---|---|---|
| Nothing leads out of cancelled | `Status.cancelled_is_terminal` | `status.rs`, `TRANSITIONS` |
| A placed order starts in placed | `Order.place_starts_placed` | ADR oms.0002 |
| A placed order has lines, all in the total's currency | `Order.place_has_lines`, `Order.place_one_currency` | `Order::place` |
| A message moves the status only along the table | `Order.step_respects_table` | `Order::move_to` |
| The same message twice changes nothing the second time | `Order.step_twice` | ADR oms.0006 |
| An authorization for another payment changes nothing | `Order.foreign_payment_ignored` | `confirm_order` |
| A late decline leaves a confirmed order alone | `Order.declined_keeps_confirmed` | ADR oms.0007 |
| A cancelled order stays exactly as it is, whatever arrives | `Order.run_after_cancelled` | `cancel_order`, `confirm_order` |
| `OrderConfirmed` is emitted at most once, whatever arrives | `Order.run_confirms_at_most_once` | ADR oms.0006 |
| `OrderCancelled` is emitted at most once, whatever arrives | `Order.run_cancels_at_most_once` | ADR oms.0007 |

Not modelled: a refusal's error (the model leaves the order alone where Rust
answers `Error::Payment`), concurrent saves (`Error::Conflict`), and anything
past this service — the ledger's payment is its own.

## Layout

- `Oms/Status.lean` — the status and the table of moves.
- `Oms/Order.lean` — money, lines, the order, `place`.
- `Oms/Policy.lean` — messages, events, `step` for one message, `run` for a sequence.
- `Oms/Scenarios.lean` — every sequence of up to four messages from a small
  alphabet, with what `run` says they end in, as JSON.
- `Scenarios.lean` — prints that JSON.

## Running it

Lean comes through [elan](https://github.com/leanprover/elan)
(`brew install elan-init`); `lean-toolchain` pins the version. From this
directory:

```bash
lake build
```

A build that passes is a proof that holds: there are no tests to run on this
side. A `sorry` builds with a warning and proves nothing.

## The fixture

`tests/fixtures/order_scenarios.json` is generated, never edited:

```bash
lake exe scenarios > ../tests/fixtures/order_scenarios.json
```

Regenerate it whenever `step`, `run` or the alphabet changes. The Rust test
cannot tell a stale fixture from a fresh one, so check before committing a
change to the model:

```bash
lake exe scenarios | diff - ../tests/fixtures/order_scenarios.json
```

No output means the fixture follows from the model.
