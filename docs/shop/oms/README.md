# Order Management

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `shop.oms`
- **Context:** [Shop](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`examples/shop/oms/`](https://github.com/shortlink-org/portolan/tree/main/examples/shop/oms)
- **Owners:** `@shortlink-org/shop-oms`, `@shortlink-org/platform`

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

- [oms.0001](../../adr/oms.0001.md) — Rust on Tokio, and the stack around it
- [oms.0002](../../adr/oms.0002.md) — An order is placed from a checked-out basket, not by a call
- [oms.0003](../../adr/oms.0003.md) — Lines and the total are copied from the basket, never repriced
- [oms.0004](../../adr/oms.0004.md) — Cancelling is allowed until the parcel moves
- [oms.0005](../../adr/oms.0005.md) — Confirmation waits for a payment service that does not exist yet

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

### shop.v1.OrderService

- **Source:** [`examples/shop/oms/vendor/proto/shortlink-org/portolan-shop-order/shop/v1/orders.proto:14`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/vendor/proto/shortlink-org/portolan-shop-order/shop/v1/orders.proto#L14)
- **Module:** [buf.build/shortlink-org/portolan-shop-order](../../modules/shortlink-org-portolan-shop-order.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `CancelOrder` | `CancelOrderRequest` | `CancelOrderResponse` | CancelOrder cancels an order that has not been dispatched yet. FAILED_PRECONDITION once it has: from then on the way back is a return, which is delivery's business, not this service's. Cancelling twice is not an error; the second call answers with the already cancelled order. |
| `GetOrder` | `GetOrderRequest` | `GetOrderResponse` | GetOrder answers with the order as it is now. NOT_FOUND for an id the service has never seen; a cancelled order is still found. |

<a id="message-cancelorderrequest"></a>
<details><summary>CancelOrderRequest</summary>

| Field | Type |
| --- | --- |
| `order_id` | `string` |

</details>

<a id="message-cancelorderresponse"></a>
<details><summary>CancelOrderResponse</summary>

| Field | Type |
| --- | --- |
| `order` | `Order` |

</details>

<a id="message-getorderrequest"></a>
<details><summary>GetOrderRequest</summary>

| Field | Type |
| --- | --- |
| `order_id` | `string` |

</details>

<a id="message-getorderresponse"></a>
<details><summary>GetOrderResponse</summary>

| Field | Type |
| --- | --- |
| `order` | `Order` |

</details>

<a id="message-line"></a>
<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `int32` |
| `unit_price` | `Money` |

</details>

<a id="message-money"></a>
<details><summary>Money</summary>

| Field | Type |
| --- | --- |
| `amount_minor` | `int64` |
| `currency` | `string` |

</details>

<a id="message-order"></a>
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

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `payments.v1.PaymentService/Authorize` | [payments.ledger](../../payments/ledger/README.md) | declared | [`examples/shop/oms/src/infrastructure/payments/proto/payments/v1/payments.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/infrastructure/payments/proto/payments/v1/payments.proto) |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [`OrderCancelled`](aggregates/order.md#event-shop-oms-order-ordercancelled) | v1 | [payments.ledger (declared)](../../payments/ledger/README.md) |
| [`OrderConfirmed`](aggregates/order.md#event-shop-oms-order-orderconfirmed) | v1 | — |
| [`OrderPlaced`](aggregates/order.md#event-shop-oms-order-orderplaced) | v1 | — |

## Schema modules

| Module | Access | Commit | Packages |
| --- | --- | --- | --- |
| [shortlink-org/portolan-shop-order](../../modules/shortlink-org-portolan-shop-order.md) | publishes | 6ae5e6ade8a547a59553b3aae02a2335 | shop.v1 |

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
