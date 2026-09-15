# create_shipment

Turns a confirmed order into a shipment waiting for the money, and asks the
ledger to move the money (ADR core.0003).

## What it does

1. Looks for the order's shipment.
2. When there is none, creates it: `awaiting-payment`, nothing packed, no
   address yet, and `ShipmentCreated` is stored with it.
3. When the shipment still waits, asks the ledger to capture the payment
   named by the order id (oms.0006).

The shipment is stored before the ledger is asked because the ledger says
`PaymentCaptured` while it answers, and the policy that hears it releases a
shipment that has to exist already.

## What follows from it

**Only the order service's fact gets here.** No endpoint runs this use case;
the policy that hears `OrderConfirmed` does. A shipment is not created by
somebody asking for one.

**The release is not this use case's.** A capture makes the ledger say
`PaymentCaptured`, and `release_shipment` runs off that fact the way it would
for money that moved any other way (core.0002). A `captured` answer here says
the ledger agreed, not that the shipment was released.

**Once per order.** A repeated confirmation finds the shipment it made. It
asks for the capture again while that shipment still waits, because the run
that stored it may have died before the ledger answered; the ledger answers a
second capture with the first.

**A refusal leaves the shipment waiting.** The ledger has never seen the
payment, or it is no longer one that can be captured - voided after a
cancellation. Nothing is written off here: the refusal does not say why, and
a cancelled order is the order service's to announce.

**An unreachable ledger is an error.** The shipment is already stored; the
fact is delivered again and the capture is asked again.

## Answers

| | |
|---|---|
| created, or found waiting, and captured | the shipment id; `captured` |
| the ledger has no such payment | the shipment id; `no-payment` |
| the payment cannot be captured | the shipment id; `not-capturable` |
| found already released or written off | the shipment id; `not-asked` |
| the ledger did not answer | an error; the shipment stays stored and waiting |

## Sequence

The sequence is derived from the code and the traces, not drawn here: see
[the policy's flow page](../../../../../../../../../docs/flows/core-create-shipment-on-order-confirmed.md),
where each hop carries its source line and whether it was seen running.
