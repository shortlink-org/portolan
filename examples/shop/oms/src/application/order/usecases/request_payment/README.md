# Request payment

## What it does

Loads a committed order. If it is still placed, asks ledger to authorize its
exact total, using the order id as the stable payment id for this checkout.

## What follows from it

The OrderPlaced policy applies an authorized reply through confirm_order. A
known decline leaves the order placed; an outage fails delivery for retry.
The separately delivered authorization event can also confirm, without another RPC.

## Answers

Authorized with payment id, declined with a closed reason, no-op for an order
already confirmed/cancelled, or an operational failure. This does not allocate
new payment attempts after a decline.

## Sequence

Committed OrderPlaced → request_payment → Payments.Authorize → confirmation.
See oms.0006 for ownership and recovery limits.
