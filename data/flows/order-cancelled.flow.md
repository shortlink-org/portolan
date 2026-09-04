# Order cancelled
owner: shop
source: services/oms/test/e2e/cancel_test.go

A customer cancels before the parcel moves, and two compensations run side by
side: the money is unwound at the gateway, and the stop is taken off the
route. Whether the money is voided or refunded depends on how far payment got,
and the delivery half is declared everywhere and observed nowhere.

## Participants
- customer: actor
- shop.oms: service
- bus: broker
- payments.ledger: service
- psp-gateway: external "psp-gateway (external)"
- delivery.core: service

## Steps
customer -> shop.oms: rpc CancelOrder [verified] @cancel_test.go:44 #x1
shop.oms -> delivery.core: rpc delivery.v1.Delivery/GetShipment @internal/oms/client/delivery.go:41 #x2
  > Cancelling is only allowed while the shipment is `held` or `planned`. The
  > state comes from delivery, not from the order, so a stale read here is what
  > lets a dispatched parcel be cancelled.
alt shipment not yet dispatched #alt-cancel
  shop.oms -> bus: event shop.oms.order.OrderCancelled [verified] @cancel_test.go:61 #x3
  par compensations, which do not wait for each other #par-compensate
    bus -> payments.ledger: event shop.oms.order.OrderCancelled [verified] @cancel_test.go:70 #x4
    alt authorization not yet captured #alt-money
      payments.ledger -> psp-gateway: rpc psp.v2.Charges/Void as "Charges.Void" [unresolved] @internal/ledger/adapter/psp/client.go:171 #x5
        > Voiding costs nothing and leaves no trace on the customer's statement,
        > which is why the capture is held back until dispatch in the first
        > place.
      payments.ledger -> payments.ledger: releaseHold [verified] @cancel_test.go:83 #x6
    else payment already captured
      payments.ledger -> psp-gateway: rpc psp.v2.Charges/Refund as "Charges.Refund" [unresolved] @internal/ledger/adapter/psp/client.go:138 #x7
      payments.ledger -> bus: event payments.ledger.refund.RefundIssued @internal/ledger/app/refund.go:88 #x8
        > The same event the support refund publishes. Nothing in the payload
        > says which of the two happened, so a consumer cannot tell a cancelled
        > order from a returned one.
    end

  and
    bus -> delivery.core: event shop.oms.order.OrderCancelled @internal/delivery/app/subscribe.go:62 #x9
      > The subscription is registered in the delivery repo, but no test covers
      > it and no trace in the sampled window shows it firing.
    delivery.core -> delivery.core: removeStopAndReplan @internal/delivery/app/route.go:112 #x10
    delivery.core -> bus: event delivery.core.route.RoutePlanned @internal/delivery/app/route.go:94 #x11
      > The route is republished without the stop. Consumers see a second
      > RoutePlanned for the same route and are expected to take the later one.
  end

  shop.oms -> customer: rpc cancellation confirmation @internal/oms/notify/cancellation.go:19 #x12
else shipment already dispatched
  shop.oms -> customer: rpc 409 Conflict [verified] @cancel_test.go:118 #x13
    > The edge refuses and points the customer at returns instead. What happens
    > from there is the refund-requested flow, and none of it is observed.
  stop
end
