# Checkout

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.cart-checkout`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts)

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.cart` | service | [shop](../shop/README.md) |
| `auth.auth` | service | [auth](../auth/README.md) |
| `cart-pg` | store | [shop](../shop/README.md) |
| `shop.pricing` | service | [shop](../shop/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.cart
    participant p2 as auth.auth
    participant p3 as cart-pg
    participant p4 as shop.pricing
    participant p5 as bus
    p0->>p1: checkout → CheckedOut
    p1->>p2: validateSession → SessionInfo
    p1->>p3: byId
    p1->>p4: GetQuote → GetQuoteResponse
    p1->>p3: save
    p1-)p5: BasketCheckedOut
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.cart** — checkout → CheckedOut
   [`examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts:60`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts#L60) · Seen running in telemetry/traces.jsonl (1 trace).
<a id="step-s2"></a>
2. **shop.cart** → **auth.auth** — validateSession → SessionInfo
   `auth.v1.Sessions/validateSession` · [`examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts:44`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts#L44) · Seen running in telemetry/traces.jsonl (1 trace).
<a id="step-s3"></a>
3. **shop.cart** → **cart-pg** — byId
   status: declared · [`examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts:48`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts#L48)
<a id="step-s4"></a>
4. **shop.cart** → **shop.pricing** — GetQuote → GetQuoteResponse
   `shop.v1.Pricing/GetQuote` · status: declared · [`examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts:55`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts#L55)
<a id="step-s5"></a>
5. **shop.cart** → **cart-pg** — save
   status: declared · [`examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts:57`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts#L57)
<a id="step-s6"></a>
6. **shop.cart** → **bus** — BasketCheckedOut
   [`shop.cart.basket.BasketCheckedOut`](../shop/cart/aggregates/basket.md#event-shop-cart-basket-basketcheckedout) · [`examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts:57`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/checkout/usecase.ts#L57) · Seen running in telemetry/traces.jsonl (1 trace).
