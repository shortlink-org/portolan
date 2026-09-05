# start_route

The van is out.

## What it does

1. Loads the route.
2. Starts it: `planned` becomes `driving`, and `RouteStarted` is stored with
   the change.

## What follows from it

**The board reads the event, not the clock.** A route is driving when the
depot said so, not when its day began; a van that never left is a planned
route that closes undriven.

## Answers

| | |
|---|---|
| started | the route id |
| no such route | refused, plainly |
| already driving or closed | refused by the lifecycle table |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the flow page](../../../../../../../../../docs/flows/core-start-route.md),
where each hop carries its source line and whether it was seen running.
