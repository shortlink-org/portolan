# Storefront BFF

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `storefront.bff`
- **Context:** [Storefront](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/bff`
- **Owners:** `@shortlink-org/platform`

Service `bff` — bounded context **storefront**. TypeScript on Node, GraphQL
over Yoga.

One graph in front of four services, for one kind of client: the storefront.
It holds no data of its own. Everything it answers with, it asked somebody
else for a moment earlier, in that somebody's own vocabulary, and translated.

## What it does

- Answers `viewer`, `basket`, `order` and `shipment` over one GraphQL
  endpoint, so a screen costs one round trip instead of four.
- Takes `addItem`, `removeItem`, `checkout` and `cancelOrder`, and passes the
  refusals back from whoever made them.
- Forwards the order's moves to `Subscription.orderStatus`, off the bus the
  order service already publishes to (bff.0004).
- Speaks one vocabulary at its edge and translates each peer's at the adapter
  (bff.0003).

## What it does not do

Owns nothing: no aggregate, no database, no event of its own (bff.0002).
Mints no session and holds no credential - auth is asked on every request.
Prices nothing, places no order, ships nothing: the cart, the order service
and delivery each decide their own, and this service carries the answers.

## Decisions

- [bff.0001](docs/adr/0001-graphql-yoga-schema-first.md) — GraphQL over Yoga, and the schema comes first
- [bff.0002](docs/adr/0002-the-storefront-owns-no-state.md) — The storefront owns no state
- [bff.0003](docs/adr/0003-the-schema-speaks-the-clients-words.md) — The schema speaks the client's words, not the peers'
- [bff.0004](docs/adr/0004-subscriptions-are-the-bus-forwarded.md) — A subscription is the bus, forwarded

## The tree

```
src/
  schema/<module>/schema.graphql        the contract; read by extract-graphql
  schema/<module>/resolvers/<Root>/<field>.ts
                                        one file per field, scaffolded by codegen,
                                        body written here; read by extract-ts
  ports/*.ts                            what a resolver may reach
  infrastructure/<peer>/                the vendored contract, the generated client,
                                        and the adapter that translates
  infrastructure/bus/                   the one subject this service listens to
  infrastructure/transport/graphql/     the context, and Yoga
  di/container.ts                       which adapter fills which port
```

## Running it

```bash
npm install
npm run generate     # resolvers from the schema, clients from the peers' contracts
npm start
```

`AUTH_URL`, `CART_URL`, `OMS_ADDR` and `DELIVERY_ADDR` say where the peers
are; each defaults to the port that service listens on locally. `NATS_URL`
switches subscriptions on - without it a subscription is answered and nothing
ever arrives on it. `TRACER_URI` switches tracing on and points at whichever collector in the
estate is running - this service brings none of its own. `PORT` defaults to
8085, and the endpoint is `/graphql`.

```bash
npm test             # the schema over the transport, with the peers stood in for
npm run typecheck
```

Generated files are committed, as everywhere in this repository: the clients
under `src/infrastructure/*/gen`, and every `*.generated.ts` beside the
schema. `npm run generate` reproduces them.

## Provides

**`storefront.v1.Basket`** — `examples/bff/src/schema/basket/schema.graphql`

- `Query.basket`
- `Mutation.addItem`
- `Mutation.removeItem`
- `Mutation.checkout`

<details><summary>QueryBasketArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

<details><summary>Basket</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `status` | `BasketStatus enum(OPEN \| CHECKED_OUT \| ABANDONED \| MERGED)` | — |
| `lines` | `[]Line` | — |
| `subtotal` | `Money` | Optional. Absent while the basket is empty: nothing has been added to add up. |

</details>

<details><summary>AddItemInput</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `ID` | — |
| `sku` | `String` | — |
| `quantity` | `Int` | — |
| `unitPrice` | `MoneyInput` | The price the customer is looking at. Captured as sent, never recomputed. |

</details>

<details><summary>RemoveItemInput</summary>

| Field | Type |
| --- | --- |
| `basketId` | `ID` |
| `sku` | `String` |

</details>

<details><summary>CheckoutInput</summary>

| Field | Type |
| --- | --- |
| `basketId` | `ID` |

</details>

<details><summary>Checkout</summary>

| Field | Type |
| --- | --- |
| `basketId` | `ID` |
| `quoteId` | `String` |
| `total` | `Money` |

</details>

<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `String` |
| `quantity` | `Int` |
| `unitPrice` | `Money` |

</details>

<details><summary>Money</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `Int` | — |
| `currency` | `String` | ISO 4217, upper case. |

</details>

<details><summary>MoneyInput</summary>

| Field | Type |
| --- | --- |
| `amountMinor` | `Int` |
| `currency` | `String` |

</details>

**`storefront.v1.Delivery`** — `examples/bff/src/schema/delivery/schema.graphql`

- `Query.shipment`

<details><summary>QueryShipmentArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

<details><summary>Shipment</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `orderId` | `ID` | — |
| `state` | `String` | What delivery calls the state of this parcel.  A string rather than an enum on purpose: delivery answers with one, and a set of values invented here would be a promise this service cannot keep. |
| `trackingCode` | `String` | Optional. The code a customer pastes into a carrier's site. |
| `parcels` | `Int` | — |

</details>

**`storefront.v1.Order`** — `examples/bff/src/schema/order/schema.graphql`

- `Query.order`
- `Mutation.cancelOrder`
- `Subscription.orderStatus`

<details><summary>QueryOrderArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

<details><summary>SubscriptionOrderStatusArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

<details><summary>Order</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `state` | `OrderState enum(PLACED \| CONFIRMED \| CANCELLED)` | — |
| `lines` | `[]Line` | — |
| `total` | `Money` | What the customer agreed to at checkout, and not a penny recomputed since. |
| `placedAt` | `DateTime` | — |

</details>

<details><summary>CancelOrderInput</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `reason` | `String` | Optional. |

</details>

<details><summary>OrderMoved</summary>

| Field | Type |
| --- | --- |
| `orderId` | `ID` |
| `state` | `OrderState enum(PLACED \| CONFIRMED \| CANCELLED)` |
| `at` | `DateTime` |

</details>

<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `String` |
| `quantity` | `Int` |
| `unitPrice` | `Money` |

</details>

<details><summary>Money</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `Int` | — |
| `currency` | `String` | ISO 4217, upper case. |

</details>

**`storefront.v1.Viewer`** — `examples/bff/src/schema/viewer/schema.graphql`

- `Query.viewer`

<details><summary>Viewer</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `userId` | `ID` | — |
| `expiresAt` | `DateTime` | When the session stops being live. |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `auth.v1.Sessions/validateSession` | [auth.auth](../../auth/auth/README.md) | declared | `examples/bff/src/infrastructure/auth/gen/openapi.yaml` |
| `cart.v1.Baskets/addItem` | [shop.cart](../../shop/cart/README.md) | declared | `examples/bff/src/infrastructure/cart/gen/openapi.yaml` |
| `cart.v1.Baskets/checkout` | [shop.cart](../../shop/cart/README.md) | declared | `examples/bff/src/infrastructure/cart/gen/openapi.yaml` |
| `cart.v1.Baskets/getBasket` | [shop.cart](../../shop/cart/README.md) | declared | `examples/bff/src/infrastructure/cart/gen/openapi.yaml` |
| `cart.v1.Baskets/removeItem` | [shop.cart](../../shop/cart/README.md) | declared | `examples/bff/src/infrastructure/cart/gen/openapi.yaml` |
| `delivery.v1.Delivery/GetShipment` | [delivery.core](../../delivery/core/README.md) | declared | `examples/bff/src/infrastructure/delivery/proto/delivery/v1/delivery.proto` |
| `shop.v1.OrderService/CancelOrder` | [shop.oms](../../shop/oms/README.md) | declared | `examples/bff/src/infrastructure/oms/proto/shop/v1/orders.proto` |
| `shop.v1.OrderService/GetOrder` | [shop.oms](../../shop/oms/README.md) | declared | `examples/bff/src/infrastructure/oms/proto/shop/v1/orders.proto` |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [bff.0001](../../adr/bff.0001.md) | GraphQL over Yoga, and the schema comes first | accepted | 2026-09-05 |
| [bff.0002](../../adr/bff.0002.md) | The storefront owns no state | accepted | 2026-09-05 |
| [bff.0003](../../adr/bff.0003.md) | The schema speaks the client's words, not the peers' | accepted | 2026-09-05 |
| [bff.0004](../../adr/bff.0004.md) | A subscription is the bus, forwarded | accepted | 2026-09-05 |
