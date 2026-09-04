# Refund requested
owner: shop
source: docs/flows/refund-requested.md

How a support-initiated refund is meant to travel: the window is read off the
shipment, an undispatched parcel is recalled first, and the money is returned
through the ledger. Written by hand from the design doc — not one step has
been observed in a test or a trace, which is why every hop on this page is
declared.

## Participants
- agent: actor "support agent"
- shop.oms: service
- delivery.core: service
- bus: broker
- payments.ledger: service

## Steps
agent -> shop.oms: rpc RequestRefund @refund-requested.md:24 #c1
  > The support console, not the storefront. The doc does not say what
  > authorizes the agent or whether a partial amount is allowed.
shop.oms -> delivery.core: rpc delivery.v1.Delivery/GetShipment @internal/oms/client/delivery.go:41 #c2
  > The refund window runs from the delivery date on the shipment, not from the
  > order date, so the shipment has to be read before anything is decided.
shop.oms -> shop.oms: checkRefundWindow @internal/oms/app/refund.go:52 #c3
  > 30 days after delivery. Orders never delivered have no window at all — the
  > doc leaves that case open.
alt shipment already delivered #alt-parcel
  shop.oms -> shop.oms: openReturnLabel @internal/oms/app/refund.go:71 #c4
else shipment still in transit
  shop.oms -> bus: event shop.oms.order.OrderCancelled @refund-requested.md:58 #c5
  bus -> delivery.core: event shop.oms.order.OrderCancelled @refund-requested.md:61 #c6
    > Delivery is expected to recall the parcel here. The handler is described
    > in the design doc, but no subscription for OrderCancelled was found in the
    > delivery repository.
end

shop.oms -> payments.ledger: rpc payments.v1.Payments/Refund @internal/oms/client/payments.go:104 #c7
  > Both branches rejoin here. The doc does not say what the amount is when the
  > parcel was recalled but the shipping was already billed.
payments.ledger -> payments.ledger: openRefund @internal/ledger/app/refund.go:31 #c8
loop polled hourly until the gateway leaves `pending`, up to 7 days #loop-settle
  payments.ledger -> payments.ledger: pollGatewaySettlement @internal/ledger/app/refund.go:64 #c9
    > The doc says the gateway confirms by webhook and that the poll is only the
    > fallback. Neither path is covered by a test, and nothing says what happens
    > on day 8.
end

alt the gateway settles the refund #alt-settlement
  payments.ledger -> bus: event payments.ledger.refund.RefundIssued @refund-requested.md:83 #c10
  par RefundIssued fan-out #par-refunded
    bus -> shop.oms: event payments.ledger.refund.RefundIssued @refund-requested.md:88 #c11
      > Moves the order to `refunded`.
  and
    bus -> delivery.core: event payments.ledger.refund.RefundIssued @refund-requested.md:91 #c12
      > Closes the return leg. Same gap as the cancel handler above: declared in
      > the doc, absent from the repository.
  end

  shop.oms -> agent: rpc refund receipt @refund-requested.md:96 #c13
else the gateway refuses the refund
  payments.ledger -> payments.ledger: recordRejection @refund-requested.md:101 #c14
    > The code and category are stored on the refund and nothing publishes them.
    > Support finds out by looking, which the doc admits and does not fix.
  stop
end
