# get_route

One route, as the depot reads it.

## What it does

1. Loads the route by id.
2. Answers with the van, the day, the status and the stops in the order they
   are driven, each with its address as a label prints it and the window
   promised for it. Never the aggregate.

## What follows from it

**The order of the stops is the route.** The answer keeps it; a caller that
wants a different order is asking for a new plan, not for this route
rearranged.

**A closed route is still found.** Closing ends the day, not the record of
it; the board reads yesterday the same way it reads today.

## Answers

| | |
|---|---|
| found | the route id, the vehicle, the day, the status, and every stop with its sequence, shipment, address, window and whether it is done |
| no such route | refused, plainly |
| freshness | as of the last commit: the read goes to the route's own tables. The load figures the board polls come from `mv_route_load`, which is refreshed after each plan and can be behind |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../../../docs/flows/core-get-route.md),
where each hop carries its source line and whether it was seen running.
