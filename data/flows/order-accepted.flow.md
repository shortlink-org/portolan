# Order accepted
owner: shop
source: services/oms/test/integration/order_accepted_test.go

The narrow slice one integration test pins end to end: an order commits with
its outbox row, the relay publishes it, the ledger picks it up and the
authorization comes back. Every hop here is asserted, which is why this is the
only flow with no gaps in it.

## Participants
- shop.oms: service
- oms-db: store in shop "oms-db (postgres)"
- bus: broker
- payments.ledger: service

## Steps
shop.oms -> oms-db: insertOrderAndOutboxRow [verified] @internal/oms/adapter/postgres/order_repo.go:141 #a1
  > The order row and the OrderPlaced outbox row commit in one transaction, so
  > the event cannot be published before the order exists or lost after it does.
shop.oms -> bus: event shop.oms.order.OrderPlaced [verified] @order_accepted_test.go:58 #a2
  > Published by the outbox relay, not by the request handler. The test waits on
  > the relay rather than on PlaceOrder returning.
bus -> payments.ledger: event shop.oms.order.OrderPlaced [verified] @order_accepted_test.go:71 #a3
  > Consumer group `ledger-orders`, at-least-once. The test replays the same
  > message a second time and asserts nothing changes.
payments.ledger -> payments.ledger: openReconciliationRecord [verified] @internal/ledger/app/intent.go:47 #a4
  > The event only opens the record the gateway webhook later matches against.
  > Authorizing is the synchronous call below, because checkout needs the answer
  > before it can confirm.
shop.oms -> payments.ledger: rpc payments.v1.Payments/Authorize [verified] @order_accepted_test.go:88 #a5
  > Carries the order's idempotency key. The gateway behind the ledger is the
  > sandbox stub here; the real hop out of the estate is drawn in the checkout
  > flow.
payments.ledger -> bus: event payments.ledger.payment.PaymentAuthorized [verified] @order_accepted_test.go:103 #a6
bus -> shop.oms: event payments.ledger.payment.PaymentAuthorized [verified] @order_accepted_test.go:114 #a7
