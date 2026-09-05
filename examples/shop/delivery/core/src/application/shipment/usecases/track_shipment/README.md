# track_shipment

What the customer sees when they paste a tracking code.

## What it does

1. Finds the shipment the tracking code was issued for.
2. Answers with its status and every scan so far, newest last. Never the
   aggregate: the page reads, it does not carry.

## What follows from it

**The code is the whole credential.** Whoever has it sees the page, so the
page holds nothing the code alone should not open: no address, no order id,
no route. A customer who wants those asks the storefront, which asks auth
first.

**Scans are history, not state.** A wrong scan is followed by a right one
and both are shown; the status is the shipment's judgement, made when the
first scan arrived, and it does not move with later ones.

## Answers

| | |
|---|---|
| found | the shipment id, its status, the code, and the scans in the order they were recorded |
| no such code | refused, plainly |
| freshness | as of the last commit: the read goes to the shipment's own table |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../../../docs/flows/core-track-shipment.md),
where each hop carries its source line and whether it was seen running.
