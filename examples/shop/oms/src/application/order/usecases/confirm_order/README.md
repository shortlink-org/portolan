# Confirm order

## What it does

Applies an authorization fact containing order id, public payment id, amount
and occurrence time. Checks identity and total, then confirms a placed order.
There is no ledger client on this operation.

## What follows from it

A committed change emits OrderConfirmed. Its existing authorizationId field
contains the public ledger payment id. Repeated facts and late facts for a
cancelled order change nothing.

## Answers

Success or no-op; mismatch, missing order or persistence conflict/failure.

## Sequence

Ledger event or successful authorization reply → confirm_order → repository.
See oms.0006 for the two delivery paths and their retry semantics.
