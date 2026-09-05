# get_order

Reads one order by id.

## What it does

1. Loads the order by id.
2. Answers with the order as it is now: its lines, total, status and when it
   was placed. Never the aggregate, and never its version.

## What follows from it

**A cancelled order is still found.** Cancelling changes the status, not the
existence of the order; a caller that asks for it gets it, marked so.

**It says plainly when there is no such order.** The caller already knows
the id, so nothing is disclosed by admitting it resolves to nothing.

**The version stays inside the service.** It names a row in this store and
exists so that a stale copy is refused on save. On the wire it would be a
number somebody builds a retry on; the caller has no save to make.

## Answers

| | |
|---|---|
| found | the order id, the customer and basket it came from, its lines and total, its status, and when it was placed |
| no such order | refused, plainly (`Error::NotFound`) |
| freshness | as of the last commit: the read goes to the aggregate's own table |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../../docs/flows/oms-get-order.md), where
each hop carries its source line and whether it was seen running.
