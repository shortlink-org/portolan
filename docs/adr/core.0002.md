# core.0002 — A shipment waits for the money, and the ledger's fact releases it

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [delivery.core](../delivery/core/README.md)
- **Source:** `examples/shop/delivery/core/docs/adr/0002-a-shipment-waits-for-the-money.md`

### Context and Problem Statement

The service's first rule is that nothing leaves the warehouse before the
money has moved. Where does that rule live, and what does the ledger's
`PaymentCaptured` do to a shipment?

The first answer was a policy that loaded the shipment and set its route to
an empty string. It modelled nothing: a shipment started `planned`, could be
dispatched at once, and the event changed no state a reader could see. The
README led with a rule the code did not have.

### Decision Drivers

- The rule must be a state the lifecycle table shows, not a comment.
- Dispatch must be refused by the table, not by a check somebody remembers.
- The ledger's fact must arrive as a fact: however the money moves, the same
  event releases the shipment.
- The policy must not decide; a use case must.

### Considered Options

1. **Dispatch asks the ledger** — an rpc at dispatch time: "is it paid?"
2. **A state `awaiting-payment`, left by a command the policy runs** — the
   shipment starts there; `PaymentCaptured` runs `release_shipment`, which
   moves it to `planned` and says `ShipmentReleased`.
3. **A flag on the shipment** — `paid: boolean`, set by the policy.

### Decision Outcome

Chosen option: **a state, left by a command the policy runs**.

| | in the table | refuses dispatch | event |
|---|---|---|---|
| ask the ledger | no | by a call, every time | none |
| a state | yes | by the table | `ShipmentReleased` |
| a flag | no | by a check | none |

`awaiting-payment` is the first state; `release` is the only way out of it
other than being written off. Dispatch from it is refused by the same table
that refuses every other move nobody wrote down. The policy imports the fact
in this service's own words, from the application layer, and calls the use
case; it knows nothing of the wire the fact came on.

Option 1 was rejected because it asks a question whose answer was already
announced, and asks it on the hot path of every dispatch. Option 3 is a
state that is not in the table, which is the thing the table exists to
prevent.

#### Consequences

- Good: the README's first rule is the lifecycle's first state.
- Good: `ShipmentReleased` is this service's fact about the money, so a
  consumer waiting to plan a route hears delivery, not the ledger.
- Bad: a second `PaymentCaptured` for the same order is refused by the
  table; the policy lets that stand, and the catalog will show the refusal
  when a bus adapter exists to deliver it.
- Neutral: nothing in this sketch reads the bus yet; the policy is the shape,
  and the adapter that feeds it is the same one the ledger has (ledger.0002).
