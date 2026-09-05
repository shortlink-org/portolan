# Order Management

*Generated from the portolan catalog · commit `9 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.oms`
- **Context:** [Shop](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/shop/oms`

Service `oms` — bounded context **shop**. Rust on Tokio.

Owns the order: what a basket became at checkout, from the moment the cart
says `BasketCheckedOut` until the order is confirmed or cancelled. It is the
only writer of order state; every other service holds a copy of what it was
told.

## What it does

- Places an order from a checked-out basket, once per basket, copying the
  lines and the total the customer agreed to.
- Answers `GetOrder` and `CancelOrder` over gRPC, `shop.v1.OrderService`.
- Confirms an order once its total is authorised with payments, and says so.
- Publishes `OrderPlaced`, `OrderConfirmed` and `OrderCancelled` through an
  outbox, over NATS JetStream.

## What it does not do

Does not price anything, move money or ship: the lines and the total are the
basket's, the money is `payments`' and the parcel is `delivery`'s. Does not
hold a catalogue or know who a customer is beyond the id the cart passed on.
Nothing in the estate provides `payments.v1` yet, so the authorisation is a
stand-in until something does, and the catalog says so.

## Decisions

- [oms.0001](docs/adr/0001-rust-on-tokio.md) — Rust on Tokio, and the stack around it
- [oms.0002](docs/adr/0002-an-order-is-placed-from-a-checked-out-basket.md) — An order is placed from a checked-out basket, not by a call
- [oms.0003](docs/adr/0003-lines-are-copied-never-repriced.md) — Lines and the total are copied from the basket, never repriced
- [oms.0004](docs/adr/0004-cancel-is-allowed-until-dispatch.md) — Cancelling is allowed until the parcel moves
- [oms.0005](docs/adr/0005-confirmation-waits-for-a-payment-that-does-not-exist-yet.md) — Confirmation waits for a payment service that does not exist yet

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

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Order](aggregates/order.md) | `Order` | 3 commands | 1 query | 3 events |

## Provides

**`shop.v1.OrderService`** — `examples/shop/oms/vendor/proto/shortlink-org/portolan-shop-order/shop/v1/orders.proto:14`

- `GetOrder`
- `CancelOrder`

<details><summary>GetOrderRequest</summary>

| Field | Type |
| --- | --- |
| `order_id` | `string` |

</details>

<details><summary>GetOrderResponse</summary>

| Field | Type |
| --- | --- |
| `order` | `Order` |

</details>

<details><summary>CancelOrderRequest</summary>

| Field | Type |
| --- | --- |
| `order_id` | `string` |

</details>

<details><summary>CancelOrderResponse</summary>

| Field | Type |
| --- | --- |
| `order` | `Order` |

</details>

<details><summary>Order</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | — |
| `customer_id` | `string` | The customer auth vouched for at checkout. Opaque here, as everywhere. |
| `basket_id` | `string` | The basket this order was placed from, so a reader can walk back to it. |
| `status` | `OrderStatus` | — |
| `lines` | `[]Line` | — |
| `total` | `Money` | The quoted total, tax and promotions included. |
| `placed_at` | `Timestamp` | — |

</details>

<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `int32` |
| `unit_price` | `Money` |

</details>

<details><summary>Money</summary>

| Field | Type |
| --- | --- |
| `amount_minor` | `int64` |
| `currency` | `string` |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `payments.v1.PaymentService/Authorize` | [payments.ledger](../../payments/ledger/README.md) | declared | `examples/shop/oms/src/infrastructure/payments/proto/payments/v1/payments.proto` |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [OrderCancelled](aggregates/order.md) | v1 | [payments.ledger (declared)](../../payments/ledger/README.md) |
| [OrderConfirmed](aggregates/order.md) | v1 | — |
| [OrderPlaced](aggregates/order.md) | v1 | — |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Order database](stores/pg.md) | postgres | owns | 3 tables |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [oms.0001](../../adr/oms.0001.md) | Rust on Tokio, and the stack around it | accepted | 2026-09-05 |
| [oms.0002](../../adr/oms.0002.md) | An order is placed from a checked-out basket, not by a call | accepted | 2026-09-05 |
| [oms.0003](../../adr/oms.0003.md) | Lines and the total are copied from the basket, never repriced | accepted | 2026-09-05 |
| [oms.0004](../../adr/oms.0004.md) | Cancelling is allowed until the parcel moves | accepted | 2026-09-05 |
| [oms.0005](../../adr/oms.0005.md) | Confirmation waits for a payment service that does not exist yet | accepted | 2026-09-05 |
