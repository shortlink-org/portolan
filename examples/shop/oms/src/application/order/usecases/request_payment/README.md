# Request payment

## What it does

Loads a committed order. If it is still placed, asks ledger to authorize its
exact total, using the order id as the stable payment id for this checkout.

## What follows from it

The OrderPlaced policy applies an authorized reply through confirm_order and a
known decline through cancel_order (oms.0007); an outage fails delivery for retry.
The separately delivered ledger events can also confirm or cancel, without another RPC.

## Answers

Authorized with payment id, declined with a closed reason, no-op for an order
already confirmed/cancelled, or an operational failure. This does not allocate
new payment attempts after a decline.

## Sequence

Committed OrderPlaced → request_payment → Payments.Authorize → confirmation or cancellation.
See oms.0006 for ownership and recovery limits.
