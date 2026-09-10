# Remove item

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.cart-remove-item`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts)

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.cart` | service | [shop](../shop/README.md) |
| `cart-pg` | store | [shop](../shop/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.cart
    participant p2 as cart-pg
    participant p3 as bus
    p0->>p1: removeItem → Basket
    p1->>p2: save
    p1-)p3: BasketItemRemoved
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.cart** — removeItem → Basket
   [`examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts:49`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts#L49) · Seen running in telemetry/traces.jsonl (1 trace).
<a id="step-s2"></a>
2. **shop.cart** → **cart-pg** — save
   status: declared · [`examples/shop/cart/src/application/basket/usecases/remove_item/usecase.ts:22`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/remove_item/usecase.ts#L22)
<a id="step-s3"></a>
3. **shop.cart** → **bus** — BasketItemRemoved
   [`shop.cart.basket.BasketItemRemoved`](../shop/cart/aggregates/basket.md#event-shop-cart-basket-basketitemremoved) · [`examples/shop/cart/src/application/basket/usecases/remove_item/usecase.ts:22`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/remove_item/usecase.ts#L22) · Seen running in telemetry/traces.jsonl (1 trace).
