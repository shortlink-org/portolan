# Checkout
owner: shop
source: services/oms/test/e2e/checkout_test.go

Basket to dispatch, as the e2e suite drives it: a priced basket, a risk call
whose peer is not in the catalog, an outbox publish, an authorization at the
gateway, a capture retried with backoff, and a shipment held until the money
lands. Three branches and two hops are read from the code rather than
observed.

## Participants
- customer: actor
- shop.oms: service
- oms-db: store in shop "oms-db (postgres)"
- shop.pricing: service
- fraud-scoring: unknown "fraud-scoring (unknown)"
- bus: broker
- payments.ledger: service
- psp-gateway: external "psp-gateway (external)"
- delivery.core: service

## Steps
customer -> shop.oms: rpc PlaceOrder [verified] @checkout_test.go:62 #s1
  > HTTP edge. The handler requires an Idempotency-Key header and replays the
  > stored response for a key it has already answered, so a double-tapped
  > checkout cannot open two orders.
shop.oms -> oms-db: loadBasket [verified] @internal/oms/adapter/postgres/basket_repo.go:58 #s2
shop.oms -> shop.oms: validateBasket [verified] @internal/oms/app/checkout.go:88 #s3
  > Rejects empty baskets and lines whose stock reservation has expired. Runs
  > before anything leaves the process.
shop.oms -> shop.pricing: rpc shop.v1.Pricing/GetQuote [verified] @internal/oms/app/checkout.go:104 #s4
  > 250 ms deadline, one retry on UNAVAILABLE.
alt pricing answers within the deadline #alt-quote
  shop.pricing -> bus: event shop.pricing.quote.QuoteIssued [verified] @checkout_test.go:96 #s5
    > Published for the audit trail. The price checkout actually uses is the
    > synchronous response above, not this event.
else pricing deadline exceeded
  shop.oms -> oms-db: readLastPriceSnapshot @internal/oms/app/checkout.go:118 #s6
    > Falls back to the snapshot written by the last price-list import and marks
    > the order repriceable. The e2e suite has no case for this branch; it is
    > read from the code.
end

shop.oms -> fraud-scoring: rpc fraud.v2.Scoring/Score [unresolved] @internal/oms/client/fraud.go:22 #s7
  > No service in the catalog provides fraud.v2.Scoring. The address comes from
  > FRAUD_ADDR at runtime, so the peer cannot be resolved statically.
alt score below 40 #alt-risk
  shop.oms -> shop.oms: acceptOrder [verified] @checkout_test.go:131 #s8
else score at or above 40
  shop.oms -> bus: event shop.oms.order.OrderCancelled @internal/oms/app/checkout.go:176 #s9
    > The customer is shown a generic decline and the score never reaches the
    > edge. Declared: the suite has no high-score fixture.
  stop
else scorer did not answer within 800 ms
  shop.oms -> shop.oms: failOpenAndFlagForReview @internal/oms/app/checkout.go:161 #s10
    > The order continues and is queued for manual review. Failing open is read
    > from the code; nothing exercises the timeout.
end

shop.oms -> oms-db: persistOrderAndOutboxRow [verified] @internal/oms/app/checkout.go:191 #s11
  > One transaction for the order and the OrderPlaced outbox row. The
  > order-accepted flow pins this hop on its own.
loop outbox relay, every 200 ms until the batch is empty #loop-outbox
  shop.oms -> bus: event shop.oms.order.OrderPlaced [verified] @checkout_test.go:118 #s12
  shop.oms -> oms-db: markOutboxRowSent [verified] @internal/oms/adapter/postgres/outbox.go:73 #s13
    > Marking happens after the broker acks, so a crash in between republishes
    > rather than drops. Consumers are expected to tolerate the repeat.
end

par OrderPlaced fan-out #par-placed
  bus -> payments.ledger: event shop.oms.order.OrderPlaced [verified] @checkout_test.go:126 #s14
    > Consumer group `ledger-orders`. Opens the reconciliation record the
    > gateway webhook later matches against.
and
  bus -> shop.pricing: event shop.oms.order.OrderPlaced @internal/pricing/app/subscribe.go:38 #s15
    > Pricing marks the quote consumed. The subscription is registered in code
    > but no test drives it.
end

shop.oms -> payments.ledger: rpc payments.v1.Payments/Authorize [verified] @checkout_test.go:141 #s16
  > Carries the same idempotency key as the edge request, so a retried checkout
  > cannot authorize twice.
alt order currency is the acquirer's settlement currency #alt-currency
  payments.ledger -> payments.ledger: settleDirect [verified] @checkout_test.go:144 #s17
    > No conversion and no FX row: `settlement` is the order amount. This is
    > every EUR order, which is most of them.
else order currency differs from the settlement currency
  payments.ledger -> payments.ledger: quoteFxRate @internal/ledger/app/fx.go:38 #s18
    > The rate comes from the acquirer, not from the daily reference feed, and
    > is refused if it is more than 60 s old. It is stored on the payment so the
    > posting can be reproduced later.
else no acquirer is configured for the currency
  payments.ledger -> bus: event payments.ledger.payment.PaymentDeclined @internal/ledger/app/authorize.go:61 #s19
    > Code `currency_unsupported`, category `hard`. Nothing retries it and no
    > other acquirer is tried, because there is only one.
  bus -> shop.oms: event payments.ledger.payment.PaymentDeclined @internal/oms/app/decline.go:18 #s20
  shop.oms -> bus: event shop.oms.order.OrderCancelled @internal/oms/app/decline.go:29 #s21
    > The customer is told the currency is not accepted. This is the one decline
    > that is worth saying out loud, and the edge says it.
  stop
end

payments.ledger -> psp-gateway: rpc psp.v2.Charges/Create as "Charges.Create (auth only)" [unresolved] @internal/ledger/adapter/psp/client.go:64 #s22
  > Third-party gateway; no service in the estate provides psp.v2.Charges. A
  > timeout here leaves the charge in a state only the gateway knows — the
  > gateway-webhook flow is what resolves it.
alt gateway approves #alt-auth
  payments.ledger -> payments.ledger: postAuthorizationHold [verified] @internal/ledger/app/authorize.go:88 #s23
  payments.ledger -> bus: event payments.ledger.payment.PaymentAuthorized [verified] @checkout_test.go:151 #s24
  bus -> shop.oms: event payments.ledger.payment.PaymentAuthorized [verified] @checkout_test.go:154 #s25
else gateway declines
  payments.ledger -> bus: event payments.ledger.payment.PaymentDeclined [verified] @checkout_test.go:167 #s26
  bus -> shop.oms: event payments.ledger.payment.PaymentDeclined [verified] @checkout_test.go:170 #s27
  shop.oms -> bus: event shop.oms.order.OrderCancelled @internal/oms/app/decline.go:29 #s28
    > The order is cancelled and the basket released. The publish is in the
    > decline handler; no assertion covers it.
  stop
end

shop.oms -> bus: event shop.oms.order.OrderConfirmed [verified] @checkout_test.go:158 #s29
bus -> delivery.core: event shop.oms.order.OrderConfirmed [verified] @internal/delivery/app/subscribe.go:44 #s30
  > Creates the shipment in `held`. Nothing is handed to a carrier until the
  > capture lands.
loop capture retried with exponential backoff, at most 5 attempts over 24 h #loop-capture
  shop.oms -> payments.ledger: rpc payments.v1.Payments/Capture @internal/oms/app/capture.go:33 #s31
    > The e2e suite stubs the ledger from this point, so the capture leg is read
    > from the client rather than observed.
  payments.ledger -> psp-gateway: rpc psp.v2.Charges/Capture as "Charges.Capture" [unresolved] @internal/ledger/adapter/psp/client.go:102 #s32
  payments.ledger -> payments.ledger: postJournalEntry [verified] @internal/ledger/app/capture.go:59 #s33
    > Idempotent by (order_id, attempt), so a retry after a timeout cannot
    > double-post. See ADR payments.0004.
  payments.ledger -> bus: event payments.ledger.payment.PaymentCaptured @internal/ledger/app/capture.go:91 #s34
end

alt captured within the attempt budget #alt-capture
  par PaymentCaptured fan-out #par-captured
    bus -> delivery.core: event payments.ledger.payment.PaymentCaptured [verified] @checkout_test.go:188 #s35
      > Releases the held shipment. This is the hop that turns money into a
      > parcel.
  and
    bus -> shop.oms: event payments.ledger.payment.PaymentCaptured [verified] @checkout_test.go:190 #s36
  end

else declined on every attempt
  payments.ledger -> bus: event payments.ledger.payment.PaymentDeclined @internal/ledger/app/capture.go:118 #s37
    > After the fifth attempt the authorization has expired anyway. Category
    > `soft`: the customer can pay again, but not on this order.
  bus -> shop.oms: event payments.ledger.payment.PaymentDeclined @internal/oms/app/decline.go:18 #s38
  shop.oms -> bus: event shop.oms.order.OrderCancelled @internal/oms/app/decline.go:29 #s39
  bus -> delivery.core: event shop.oms.order.OrderCancelled @internal/delivery/app/subscribe.go:62 #s40
    > Drops the shipment that has been sitting in `held` since the order was
    > confirmed. Nothing observed this hop — it is the failure path nobody has
    > watched run.
  stop
end

delivery.core -> delivery.core: planRoute [verified] @internal/delivery/app/route.go:71 #s41
delivery.core -> bus: event delivery.core.route.RoutePlanned @internal/delivery/app/route.go:94 #s42
  > OMS subscribes to this for the promised delivery date. The publish is in the
  > planner; the suite asserts the shipment, not the route.
delivery.core -> bus: event delivery.core.shipment.ShipmentDispatched [verified] @checkout_test.go:203 #s43
bus -> shop.oms: event delivery.core.shipment.ShipmentDispatched [verified] @checkout_test.go:206 #s44
shop.oms -> customer: rpc order confirmation @internal/oms/notify/confirmation.go:27 #s45
  > Handed to the transactional mail provider. The hop leaves the estate and
  > nothing in the catalog covers what happens to it.
