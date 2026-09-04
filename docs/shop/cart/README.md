# Shopping Cart

*Generated from the portolan catalog · commit `8 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.cart`
- **Context:** [Shop](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/shop/cart`

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

- [cart.0001](docs/adr/0001-typescript-on-node.md) — TypeScript on Node.js, and the stack around it
- [cart.0002](docs/adr/0002-currency-frozen-at-the-first-item.md) — A basket freezes its currency at the first item
- [cart.0003](docs/adr/0003-prices-captured-never-recomputed.md) — Line prices are captured when added, never recomputed
- [cart.0004](docs/adr/0004-checkout-confirms-with-auth-and-pricing.md) — Checkout confirms the session with `auth` and the total with `pricing`
- [cart.0005](docs/adr/0005-a-merge-moves-every-line-or-none.md) — A merge moves every line or none
- [cart.0006](docs/adr/0006-abandonment-is-a-sweep-that-publishes.md) — Abandonment is a sweep inside the service, and it publishes
- [cart.0007](docs/adr/0007-an-anonymous-basket-is-owned-by-its-token.md) — An anonymous basket is owned by whoever holds its token
- [cart.0008](docs/adr/0008-events-leave-over-nats-jetstream.md) — Events leave the service over NATS JetStream, and the outbox stays

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

**`cart.v1.Baskets`** — `examples/shop/cart/src/infrastructure/transport/http/gen/openapi.yaml`

- `createBasket`
- `getBasket`
- `addItem`
- `removeItem`
- `mergeBaskets`
- `checkout`

<details><summary>BasketCreated</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `string (uuid)` | — |
| `token` | `string` | The capability to change this basket; sent back as X-Basket-Token. |

</details>

<details><summary>Basket</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `string (uuid)` | — |
| `customerId` | `string` | Optional. Present once the basket belongs to a signed-in customer. |
| `currency` | `string` | Optional. Set by the first line; absent while the basket is empty. |
| `status` | `string` | — |
| `items` | `[]LineItem` | — |
| `subtotal` | `Money` | Optional. |
| `touchedAt` | `string (date-time)` | — |

</details>

<details><summary>Error</summary>

| Field | Type |
| --- | --- |
| `message` | `string` |

</details>

<details><summary>AddItemRequest</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `integer` |
| `unitPrice` | `Money` |

</details>

<details><summary>MergeRequest</summary>

| Field | Type |
| --- | --- |
| `fromBasketId` | `string (uuid)` |
| `fromToken` | `string` |

</details>

<details><summary>CheckedOut</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `string (uuid)` | — |
| `quoteId` | `string` | The quote pricing issued; the order is placed against it. |
| `total` | `Money` | — |

</details>

<details><summary>LineItem</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `integer` |
| `unitPrice` | `Money` |

</details>

<details><summary>Money</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `integer (int64)` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `auth.v1.Sessions/validateSession` | [auth.auth](../../auth/auth/README.md) | verified | `examples/shop/cart/src/infrastructure/auth/gen/openapi.yaml` |
| `shop.v1.Pricing/GetQuote` | [shop.pricing](../pricing/README.md) | declared | `examples/shop/cart/src/infrastructure/pricing/proto/shop/v1/pricing.proto` |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [BasketAbandoned](aggregates/basket.md) | v1 | — |
| [BasketCheckedOut](aggregates/basket.md) | v1 | [shop.oms](../oms/README.md), [shop.pricing (declared)](../pricing/README.md) |
| [BasketCreated](aggregates/basket.md) | v1 | — |
| [BasketItemAdded](aggregates/basket.md) | v1 | — |
| [BasketItemRemoved](aggregates/basket.md) | v1 | — |
| [BasketMerged](aggregates/basket.md) | v1 | — |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Cart database](stores/pg.md) | postgres | owns | 3 tables |
