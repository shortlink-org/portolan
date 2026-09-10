# Checkout across cart, OMS and ledger

This scenario runs the three real services against isolated Postgres databases
and NATS JetStream. Cart uses its local auth/pricing stand-ins; a local HTTP
server answers Stripe's hold route. No external payment account is contacted.

Prerequisites: Docker, Node 26+, Rust, Java 21+, Maven and Buf; install cart's
locked dependencies with `npm ci` in `examples/shop/cart` first.

From the repository root:

```sh
node --test examples/scenarios/contracts.test.mjs
(cd examples/shop/cart && npm test -- src/testing/checkout-contract.test.ts && npm run build)
(cd examples/shop/oms && cargo test --test usecases --test payments_client && cargo build --bins)
(cd examples/payments/ledger && mvn -q clean -Dtest=CheckoutContractTest test package)
node examples/scenarios/checkout.mjs
```

The contract test compares consumer/provider protobuf field numbers, types,
enums and RPC signatures in both directions. Cart and ledger serialize actual
producer events against the fixtures consumed by OMS tests.

The live scenario creates a basket, adds EUR 9.00 of goods and checks it out.
It asserts a confirmed order over OMS gRPC and one authorized ledger payment.
It redelivers checkout, placement and authorization events, then asserts one
order, one confirmation and one gateway call. Containers use dynamic local
ports, all created resources are stopped on completion, and logs remain in a
printed temporary directory.

OrderPlaced requests payment only after its transaction commits. The payment id
is the order id for this checkout attempt. Both the RPC answer and the ledger
fact reach the same confirmation operation; that operation never calls ledger.
A known decline leaves the order placed; an outage is retried by message delivery.

This covers authorization, not capture or fulfilment. Ledger still lacks an
outbox and gateway idempotency; a lost gateway result before ledger persistence
and cancellation racing authorization are not solved by this scenario.
