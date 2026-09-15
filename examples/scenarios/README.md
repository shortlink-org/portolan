# Checkout across cart, OMS, ledger and delivery

This scenario runs the four real services against isolated Postgres databases
and NATS JetStream. Cart uses its local auth/pricing stand-ins; a local HTTP
server answers Stripe's hold and capture routes. No external payment account is contacted.

Prerequisites: Docker, Node 26+, Rust, Java 21+, Maven and Buf; install the locked
dependencies with `npm ci` in `examples/shop/cart` and in
`examples/shop/delivery/core` first.

From the repository root:

```sh
node --test examples/scenarios/contracts.test.mjs
(cd examples/shop/cart && npm test -- src/testing/checkout-contract.test.ts && npm run build)
(cd examples/shop/oms && cargo test --test usecases --test payments_client && cargo build --bins)
(cd examples/payments/ledger && mvn -q clean -Dtest=CheckoutContractTest test package)
(cd examples/shop/delivery/core && npm test -- src/application src/infrastructure/ledger src/infrastructure/bus && npm run build)
node examples/scenarios/checkout.mjs
```

The contract test compares consumer/provider protobuf field numbers, types,
enums and RPC signatures in both directions. Cart and ledger serialize actual
producer events against the fixtures consumed by OMS tests.

The live scenario creates a basket, adds EUR 9.00 of goods and checks it out.
It asserts a confirmed order over OMS gRPC, a shipment released by delivery and
one captured ledger payment. It redelivers checkout, placement, authorization
and confirmation events, then asserts one order, one confirmation, one shipment
with one ShipmentCreated and one ShipmentReleased, one hold and one capture at
the gateway. Containers use dynamic local
ports, all created resources are stopped on completion, and logs remain in a
printed temporary directory.

OrderPlaced requests payment only after its transaction commits. The payment id
is the order id for this checkout attempt. Both the RPC answer and the ledger
fact reach the same confirmation operation; that operation never calls ledger.
A known decline cancels the order (oms.0007); an outage is retried by message delivery.

OrderConfirmed creates the shipment in delivery, which then asks ledger to
capture the payment named by the order id; ledger's PaymentCaptured releases
the shipment (delivery ADRs core.0002 and core.0003). Delivery's tables live in
a `delivery` schema of the OMS database, because its packages keep a foreign
key into the orders table (core.0001).

This covers authorization, capture and the release of the shipment, not
packing, dispatch or a delivery relay: delivery's outbox is asserted, not sent.
Ledger still lacks an outbox and gateway idempotency; a lost gateway result
before ledger persistence, cancellation racing authorization, and cancellation
after capture (a refund, not a void) are not solved by this scenario.

[lean/](lean/README.md) models the same checkout and checks every interleaving:
it proves that a confirmed order always has its money held or captured, gives
the shortest trace for each of the last two gaps, and shows a third: a lost
`PaymentCaptured` leaves the shipment waiting for good, because a repeated
capture answers without publishing again.
