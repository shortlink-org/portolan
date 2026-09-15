# release_shipment

Lets a shipment out of the waiting room once the money for its order moved.

## What it does

1. Finds the shipment for the order.
2. Releases it: `awaiting-payment` becomes `planned`, and `ShipmentReleased`
   is stored with the change.

## What follows from it

**Only the ledger's fact gets here.** No endpoint runs this use case; the
policy that hears `PaymentCaptured` does. Nothing outside the service can
say the money moved, so nothing outside can release a shipment.

**A second `PaymentCaptured` for the same order changes nothing.** The bus
delivers a fact at least once, and the ledger says `PaymentCaptured` again for
a repeated capture (ledger.0004), so a shipment already out of the waiting room
is left as it is and nothing is refused: a refusal would only have the same
fact delivered again, and again.

## Answers

| | |
|---|---|
| released | nothing; `ShipmentReleased` is on the bus |
| no shipment for the order | refused, plainly |
| already out of the waiting room | nothing; the fact was acted on before |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the policy's flow page](../../../../../../../../../docs/flows/core-release-shipment-on-payment-captured.md),
where each hop carries its source line and whether it was seen running.
