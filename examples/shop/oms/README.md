# Order Management

Service `oms` — bounded context **shop**. Rust on Tokio.

Owns the order: what a basket became at checkout, from the moment the cart
says `BasketCheckedOut` until the order is confirmed or cancelled. It is the
only writer of order state; every other service holds a copy of what it was
told.

## What it does

- Places an order from a checked-out basket, once per basket, copying the
  lines and the total the customer agreed to.
- Answers `GetOrder` and `CancelOrder` over gRPC, `shop.v1.OrderService`.
- Requests ledger authorization from the committed `OrderPlaced`, with the order
  id as the stable payment id. Confirms from the RPC answer or
  `ledger.PaymentAuthorized`, once, without authorizing again.
- Publishes `OrderPlaced`, `OrderConfirmed` and `OrderCancelled` through an
  outbox, over NATS JetStream.

## What it does not do

Does not price anything, move money or ship: the lines and the total are the
basket's, the money is `payments`' and the parcel is `delivery`'s. Does not
hold a catalogue or know who a customer is beyond the id the cart passed on.
The provider is `examples/payments/ledger`. The consumer-owned protobuf subset
matches its field numbers and outcomes; no gateway authorization handle leaves
ledger. A declined payment leaves the order placed for an explicit cancellation
or a future payment-retry decision; an unavailable ledger fails delivery for retry.

## Decisions

- [oms.0001](docs/adr/0001-rust-on-tokio.md) — Rust on Tokio, and the stack around it
- [oms.0002](docs/adr/0002-an-order-is-placed-from-a-checked-out-basket.md) — An order is placed from a checked-out basket, not by a call
- [oms.0003](docs/adr/0003-lines-are-copied-never-repriced.md) — Lines and the total are copied from the basket, never repriced
- [oms.0004](docs/adr/0004-cancel-is-allowed-until-dispatch.md) — Cancelling is allowed until the parcel moves
- [oms.0005](docs/adr/0005-confirmation-waits-for-a-payment-that-does-not-exist-yet.md) — Original placeholder for payment confirmation (superseded by oms.0006)

- [oms.0006](docs/adr/0006-order-placed-requests-ledger-authorization.md) — OrderPlaced requests authorization; confirmation applies the fact idempotently

## Running it

```bash
docker compose up -d
cargo run
```

`NATS_URL` is where events arrive and leave; without it the bus is in process
and nothing does. `PAYMENTS_ADDR` points confirmation at a ledger; without it
every authorisation is granted. `TRACER_URI` switches tracing on. `cargo test`
runs everything; without Docker the tests that need Postgres or NATS are
skipped.

For the real cart → OMS → ledger scenario and contract checks, see
[checkout scenario](../../scenarios/README.md).
