# get_shipment

One shipment, for whoever is asking about an order.

## What it does

1. Loads the shipment by id.
2. Answers with the order it carries, its status, its tracking code and how
   many parcels it is. Never the aggregate.

## What follows from it

**The address is not on the answer.** The order owns it; the copy the
shipment keeps exists so a parcel on a van does not move when a profile is
edited, and it is for the van, not for the caller.

**It says plainly when there is no such shipment.** The caller already
knows the id, so nothing is disclosed by admitting it resolves to nothing.

## Answers

| | |
|---|---|
| found | the shipment id, the order id, the status, the tracking code (empty until dispatched) and the parcel count |
| no such shipment | refused, plainly |
| freshness | as of the last commit: the read goes to the shipment's own table |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../../../docs/flows/core-get-shipment.md),
where each hop carries its source line and whether it was seen running.
