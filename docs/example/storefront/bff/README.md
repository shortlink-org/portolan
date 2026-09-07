# Storefront BFF

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `storefront.bff`
- **Context:** [Storefront](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`examples/bff/`](https://github.com/shortlink-org/portolan/tree/main/examples/bff)
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

- [bff.0001](../../adr/bff.0001.md) — GraphQL over Yoga, and the schema comes first
- [bff.0002](../../adr/bff.0002.md) — The storefront owns no state
- [bff.0003](../../adr/bff.0003.md) — The schema speaks the client's words, not the peers'
- [bff.0004](../../adr/bff.0004.md) — A subscription is the bus, forwarded

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

### storefront.v1.Basket

- **Source:** [`examples/bff/src/schema/basket/schema.graphql`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/basket/schema.graphql)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `Mutation.addItem` | `AddItemInput` | `Basket` | Add a line, or increase one already there. |
| `Mutation.checkout` | `CheckoutInput` | `Checkout` | Freeze the basket and hand it on.  No order exists when this answers. The cart publishes that the basket was checked out, and the order service places one when it hears; ask for `order` a moment later, or listen to `orderStatus`. |
| `Mutation.removeItem` | `RemoveItemInput` | `Basket` | Remove a line outright. |
| `Query.basket` | `QueryBasketArgs` | `Basket` | The basket as it stands, or null when there is no such basket to show. |

<a id="message-additeminput"></a>
<details><summary>AddItemInput</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `ID` | — |
| `sku` | `String` | — |
| `quantity` | `Int` | — |
| `unitPrice` | `MoneyInput` | The price the customer is looking at. Captured as sent, never recomputed. |

</details>

<a id="message-basket"></a>
<details><summary>Basket</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `status` | `BasketStatus enum(OPEN \| CHECKED_OUT \| ABANDONED \| MERGED)` | — |
| `lines` | `[]Line` | — |
| `subtotal` | `Money` | Optional. Absent while the basket is empty: nothing has been added to add up. |

</details>

<a id="message-checkout"></a>
<details><summary>Checkout</summary>

| Field | Type |
| --- | --- |
| `basketId` | `ID` |
| `quoteId` | `String` |
| `total` | `Money` |

</details>

<a id="message-checkoutinput"></a>
<details><summary>CheckoutInput</summary>

| Field | Type |
| --- | --- |
| `basketId` | `ID` |

</details>

<a id="message-line"></a>
<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `String` |
| `quantity` | `Int` |
| `unitPrice` | `Money` |

</details>

<a id="message-money"></a>
<details><summary>Money</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `Int` | — |
| `currency` | `String` | ISO 4217, upper case. |

</details>

<a id="message-moneyinput"></a>
<details><summary>MoneyInput</summary>

| Field | Type |
| --- | --- |
| `amountMinor` | `Int` |
| `currency` | `String` |

</details>

<a id="message-querybasketargs"></a>
<details><summary>QueryBasketArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

<a id="message-removeiteminput"></a>
<details><summary>RemoveItemInput</summary>

| Field | Type |
| --- | --- |
| `basketId` | `ID` |
| `sku` | `String` |

</details>

### storefront.v1.Delivery

- **Source:** [`examples/bff/src/schema/delivery/schema.graphql`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/delivery/schema.graphql)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `Query.shipment` | `QueryShipmentArgs` | `Shipment` | Where the parcel is, or null when nothing has been handed to a carrier yet. |

<a id="message-queryshipmentargs"></a>
<details><summary>QueryShipmentArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

<a id="message-shipment"></a>
<details><summary>Shipment</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `orderId` | `ID` | — |
| `state` | `String` | What delivery calls the state of this parcel.  A string rather than an enum on purpose: delivery answers with one, and a set of values invented here would be a promise this service cannot keep. |
| `trackingCode` | `String` | Optional. The code a customer pastes into a carrier's site. |
| `parcels` | `Int` | — |

</details>

### storefront.v1.Order

- **Source:** [`examples/bff/src/schema/order/schema.graphql`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/order/schema.graphql)

| Method | Request | Response | Mode | Doc |
| --- | --- | --- | --- | --- |
| `Mutation.cancelOrder` | `CancelOrderInput` | `Order` | — | Cancel an order that has not been dispatched. Cancelling twice is not an error. |
| `Query.order` | `QueryOrderArgs` | `Order` | — | The order, or null when the storefront has never been told of one. |
| `Subscription.orderStatus` | `SubscriptionOrderStatusArgs` | `OrderMoved` | server | Every move an order makes, until it stops moving.  The storefront does not poll the order service for this: the moves are on the bus already, and this is the same events, forwarded to whoever is watching this order. |

<a id="message-cancelorderinput"></a>
<details><summary>CancelOrderInput</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `reason` | `String` | Optional. |

</details>

<a id="message-line"></a>
<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `String` |
| `quantity` | `Int` |
| `unitPrice` | `Money` |

</details>

<a id="message-money"></a>
<details><summary>Money</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `Int` | — |
| `currency` | `String` | ISO 4217, upper case. |

</details>

<a id="message-order"></a>
<details><summary>Order</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `ID` | — |
| `state` | `OrderState enum(PLACED \| CONFIRMED \| CANCELLED)` | — |
| `lines` | `[]Line` | — |
| `total` | `Money` | What the customer agreed to at checkout, and not a penny recomputed since. |
| `placedAt` | `DateTime` | — |

</details>

<a id="message-ordermoved"></a>
<details><summary>OrderMoved</summary>

| Field | Type |
| --- | --- |
| `orderId` | `ID` |
| `state` | `OrderState enum(PLACED \| CONFIRMED \| CANCELLED)` |
| `at` | `DateTime` |

</details>

<a id="message-queryorderargs"></a>
<details><summary>QueryOrderArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

<a id="message-subscriptionorderstatusargs"></a>
<details><summary>SubscriptionOrderStatusArgs</summary>

| Field | Type |
| --- | --- |
| `id` | `ID` |

</details>

### storefront.v1.Viewer

- **Source:** [`examples/bff/src/schema/viewer/schema.graphql`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/viewer/schema.graphql)

| Method | Response | Doc |
| --- | --- | --- |
| `Query.viewer` | `Viewer` | Who the request belongs to, or null when it belongs to nobody.  There is no `login` here. Sessions are minted by auth and nowhere else, and a BFF that took a password would be a second place credentials go. |

<a id="message-viewer"></a>
<details><summary>Viewer</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `userId` | `ID` | — |
| `expiresAt` | `DateTime` | When the session stops being live. |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `auth.v1.Sessions/validateSession` | [auth.auth](../../auth/auth/README.md) | declared | [`examples/bff/src/infrastructure/auth/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/auth/gen/openapi.yaml) |
| `cart.v1.Baskets/addItem` | [shop.cart](../../shop/cart/README.md) | declared | [`examples/bff/src/infrastructure/cart/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/cart/gen/openapi.yaml) |
| `cart.v1.Baskets/checkout` | [shop.cart](../../shop/cart/README.md) | declared | [`examples/bff/src/infrastructure/cart/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/cart/gen/openapi.yaml) |
| `cart.v1.Baskets/getBasket` | [shop.cart](../../shop/cart/README.md) | declared | [`examples/bff/src/infrastructure/cart/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/cart/gen/openapi.yaml) |
| `cart.v1.Baskets/removeItem` | [shop.cart](../../shop/cart/README.md) | declared | [`examples/bff/src/infrastructure/cart/gen/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/cart/gen/openapi.yaml) |
| `delivery.v1.Delivery/GetShipment` | [delivery.core](../../delivery/core/README.md) | declared | [`examples/bff/src/infrastructure/delivery/proto/delivery/v1/delivery.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/delivery/proto/delivery/v1/delivery.proto) |
| `shop.v1.OrderService/CancelOrder` | [shop.oms](../../shop/oms/README.md) | declared | [`examples/bff/src/infrastructure/oms/proto/shop/v1/orders.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/oms/proto/shop/v1/orders.proto) |
| `shop.v1.OrderService/GetOrder` | [shop.oms](../../shop/oms/README.md) | declared | [`examples/bff/src/infrastructure/oms/proto/shop/v1/orders.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/oms/proto/shop/v1/orders.proto) |

## Channels

### shop.oms.order

**Order moves**

Every move an order makes, published by the order service.

Source: [`examples/bff/src/infrastructure/bus/asyncapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/infrastructure/bus/asyncapi.yaml)

| Direction | Message | Title |
| --- | --- | --- |
| receive | [`oms.OrderPlaced`](../../shop/oms/aggregates/order.md#event-shop-oms-order-orderplaced) | An order came into being from a checked-out basket |
| receive | [`oms.OrderConfirmed`](../../shop/oms/aggregates/order.md#event-shop-oms-order-orderconfirmed) | The payment was authorised and the order may be fulfilled |
| receive | [`oms.OrderCancelled`](../../shop/oms/aggregates/order.md#event-shop-oms-order-ordercancelled) | The order will not be fulfilled |

## Commands

| Run | Body | Source |
| --- | --- | --- |
| `npm run build` | `tsc -p tsconfig.build.json` | [`examples/bff/package.json:12`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L12) |
| `npm start` | `node dist/main.js` | [`examples/bff/package.json:13`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L13) |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` | [`examples/bff/package.json:14`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L14) |
| `npm test` | `vitest run` | [`examples/bff/package.json:15`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L15) |
| `npm run generate` | `npm run generate:resolvers && npm run generate:auth && npm run generate:cart && npm run generate:grpc` | [`examples/bff/package.json:16`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L16) |
| `npm run generate:resolvers` | `graphql-codegen --config codegen.ts` | [`examples/bff/package.json:17`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L17) |
| `npm run generate:auth` | `openapi-typescript src/infrastructure/auth/gen/openapi.yaml -o src/infrastructure/auth/gen/types.ts` | [`examples/bff/package.json:18`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L18) |
| `npm run generate:cart` | `openapi-typescript src/infrastructure/cart/gen/openapi.yaml -o src/infrastructure/cart/gen/types.ts` | [`examples/bff/package.json:19`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L19) |
| `npm run generate:grpc` | `buf generate --template buf.gen.oms.yaml && buf generate --template buf.gen.delivery.yaml` | [`examples/bff/package.json:20`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/package.json#L20) |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [bff.0001](../../adr/bff.0001.md) | GraphQL over Yoga, and the schema comes first | accepted | 2026-09-05 |
| [bff.0002](../../adr/bff.0002.md) | The storefront owns no state | accepted | 2026-09-05 |
| [bff.0003](../../adr/bff.0003.md) | The schema speaks the client's words, not the peers' | accepted | 2026-09-05 |
| [bff.0004](../../adr/bff.0004.md) | A subscription is the bus, forwarded | accepted | 2026-09-05 |
