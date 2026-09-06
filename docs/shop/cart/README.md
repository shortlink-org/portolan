# Shopping Cart

*Generated from the portolan catalog · commit `11 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `shop.cart`
- **Context:** [Shop](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`examples/shop/cart/`](https://github.com/shortlink-org/portolan/tree/main/examples/shop/cart)
- **Owners:** `@shortlink-org/shop`

Service `cart` — bounded context **shop**. TypeScript on Node.js.

Owns the basket: the one mutable thing between a customer arriving and an
order existing. A basket belongs to a visitor's token or to a signed-in
customer, changes as items go in and out, and stops changing the moment it is
checked out — from then on the order is somebody else's aggregate and the
basket is a record of what was bought.

## What it does

- Creates a basket for a visitor and lets items go in and out of it.
- Merges a visitor's basket into a customer's after login.
- Checks out: confirms the session with `auth`, takes a quote from `pricing`,
  freezes the basket and says so with `BasketCheckedOut`.
- Abandons baskets nobody has touched for a day, and says so.

## What it does not do

Does not place the order, charge anything or reserve stock: `BasketCheckedOut`
is where its job ends. Does not hold a catalogue - a SKU is a string it was
given, with the price it was given. Does not know who a customer is beyond an
opaque id `auth` vouched for.

## Decisions

- [cart.0001](../../adr/cart.0001.md) — TypeScript on Node.js, and the stack around it
- [cart.0002](../../adr/cart.0002.md) — A basket freezes its currency at the first item
- [cart.0003](../../adr/cart.0003.md) — Line prices are captured when added, never recomputed
- [cart.0004](../../adr/cart.0004.md) — Checkout confirms the session with `auth` and the total with `pricing`
- [cart.0005](../../adr/cart.0005.md) — A merge moves every line or none
- [cart.0006](../../adr/cart.0006.md) — Abandonment is a sweep inside the service, and it publishes
- [cart.0007](../../adr/cart.0007.md) — An anonymous basket is owned by whoever holds its token
- [cart.0008](../../adr/cart.0008.md) — Events leave the service over NATS JetStream, and the outbox stays

## Running it

```bash
docker compose up -d
npm start
```

`AUTH_URL` and `PRICING_ADDR` point checkout at running peers; without them
every session is live and the quote is the sum of the lines. `NATS_URL` is
where events leave the service; without it the bus is in process and nothing
does. `TRACER_URI` switches tracing on. `npm test` runs everything; without
Docker the tests that need Postgres or NATS are skipped.

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Basket](aggregates/basket.md) | `Basket` | 6 commands | 1 query | 6 events |

## Provides

### cart.v1.Baskets

- **Source:** [`examples/shop/cart/src/infrastructure/transport/http/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/http/gen/openapi.yaml)

| Method | Route | Request | Response |
| --- | --- | --- | --- |
| `addItem` | `POST /v1/baskets/{basketId}/items` | `AddItemRequest` | `Basket` |
| `checkout` | `POST /v1/baskets/{basketId}/checkout` | — | `CheckedOut` |
| `createBasket` | `POST /v1/baskets` | — | `BasketCreated` |
| `getBasket` | `GET /v1/baskets/{basketId}` | — | `Basket` |
| `mergeBaskets` | `POST /v1/baskets/{basketId}/merge` | `MergeRequest` | `Basket` |
| `removeItem` | `DELETE /v1/baskets/{basketId}/items/{sku}` | — | `Basket` |

<a id="message-additemrequest"></a>
<details><summary>AddItemRequest</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `integer` |
| `unitPrice` | `Money` |

</details>

<a id="message-basket"></a>
<details><summary>Basket</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `string (uuid)` | — |
| `customerId` | `string` | Optional. Present once the basket belongs to a signed-in customer. |
| `currency` | `string` | Optional. Set by the first line; absent while the basket is empty. |
| `status` | `string enum(open \| checked-out \| abandoned \| merged)` | — |
| `items` | `[]LineItem` | — |
| `subtotal` | `Money` | Optional. |
| `touchedAt` | `string (date-time)` | — |

</details>

<a id="message-basketcreated"></a>
<details><summary>BasketCreated</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `string (uuid)` | — |
| `token` | `string` | The capability to change this basket; sent back as X-Basket-Token. |

</details>

<a id="message-checkedout"></a>
<details><summary>CheckedOut</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `string (uuid)` | — |
| `quoteId` | `string` | The quote pricing issued; the order is placed against it. |
| `total` | `Money` | — |

</details>

<a id="message-error"></a>
<details><summary>Error</summary>

| Field | Type |
| --- | --- |
| `message` | `string` |

</details>

<a id="message-lineitem"></a>
<details><summary>LineItem</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `integer` |
| `unitPrice` | `Money` |

</details>

<a id="message-mergerequest"></a>
<details><summary>MergeRequest</summary>

| Field | Type |
| --- | --- |
| `fromBasketId` | `string (uuid)` |
| `fromToken` | `string` |

</details>

<a id="message-money"></a>
<details><summary>Money</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `integer (int64)` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `auth.v1.Sessions/validateSession` | [auth.auth](../../auth/auth/README.md) | verified | [`examples/shop/cart/src/infrastructure/auth/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/auth/gen/openapi.yaml) |
| `shop.v1.Pricing/GetQuote` | [shop.pricing](../pricing/README.md) | declared | [`examples/shop/cart/src/infrastructure/pricing/proto/shop/v1/pricing.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/pricing/proto/shop/v1/pricing.proto) |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [`BasketAbandoned`](aggregates/basket.md#event-shop-cart-basket-basketabandoned) | v1 | — |
| [`BasketCheckedOut`](aggregates/basket.md#event-shop-cart-basket-basketcheckedout) | v1 | [shop.oms](../oms/README.md), [shop.pricing (declared)](../pricing/README.md) |
| [`BasketCreated`](aggregates/basket.md#event-shop-cart-basket-basketcreated) | v1 | — |
| [`BasketItemAdded`](aggregates/basket.md#event-shop-cart-basket-basketitemadded) | v1 | — |
| [`BasketItemRemoved`](aggregates/basket.md#event-shop-cart-basket-basketitemremoved) | v1 | — |
| [`BasketMerged`](aggregates/basket.md#event-shop-cart-basket-basketmerged) | v1 | — |

## Channels

### shop.cart.basket

**Basket**

One subject per aggregate, dotted the way a NATS subject is. The subject is the topic the outbox row held, and the event's name is on the message metadata, so a subscriber dispatches without parsing the payload.

Source: [`examples/shop/cart/src/infrastructure/transport/bus/asyncapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/bus/asyncapi.yaml)

| Direction | Message | Title | Doc |
| --- | --- | --- | --- |
| send | [`cart.BasketCreated`](aggregates/basket.md#event-shop-cart-basket-basketcreated) | Basket created | A basket exists, for a visitor or for a customer. |
| send | [`cart.BasketItemAdded`](aggregates/basket.md#event-shop-cart-basket-basketitemadded) | Item added | A line was added, or an existing line grew. |
| send | [`cart.BasketItemRemoved`](aggregates/basket.md#event-shop-cart-basket-basketitemremoved) | Item removed | A line is gone from the basket. |
| send | [`cart.BasketCheckedOut`](aggregates/basket.md#event-shop-cart-basket-basketcheckedout) | Basket checked out | The basket is closed and an order is expected. This is the message anything downstream of the cart waits for. |
| send | [`cart.BasketAbandoned`](aggregates/basket.md#event-shop-cart-basket-basketabandoned) | Basket abandoned | Nobody touched the basket for long enough that it was let go. |
| send | [`cart.BasketMerged`](aggregates/basket.md#event-shop-cart-basket-basketmerged) | Basket merged | A visitor signed in and their basket was folded into their own. |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Cart database](stores/pg.md) | postgres | owns | 3 tables |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [cart.0001](../../adr/cart.0001.md) | TypeScript on Node.js, and the stack around it | accepted | 2026-09-04 |
| [cart.0002](../../adr/cart.0002.md) | A basket freezes its currency at the first item | accepted | 2026-09-04 |
| [cart.0003](../../adr/cart.0003.md) | Line prices are captured when added, never recomputed | accepted | 2026-09-04 |
| [cart.0004](../../adr/cart.0004.md) | Checkout confirms the session with `auth` and the total with `pricing` | accepted | 2026-09-04 |
| [cart.0005](../../adr/cart.0005.md) | A merge moves every line or none | accepted | 2026-09-04 |
| [cart.0006](../../adr/cart.0006.md) | Abandonment is a sweep inside the service, and it publishes | accepted | 2026-09-04 |
| [cart.0007](../../adr/cart.0007.md) | An anonymous basket is owned by whoever holds its token | accepted | 2026-09-04 |
| [cart.0008](../../adr/cart.0008.md) | Events leave the service over NATS JetStream, and the outbox stays | accepted | 2026-09-05 |
