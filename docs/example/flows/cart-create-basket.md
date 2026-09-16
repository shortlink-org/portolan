# Create basket

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.cart-create-basket`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `http` · POST /v1/baskets
- **Root confidence:** high
- **Source:** [`examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts)

 Source-backed cross-protocol continuations are included.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `shop.cart` | service | [shop](../shop/README.md) | — |
| `cart-pg` | store | [shop](../shop/README.md) | [shop.cart.pg](../shop/cart/stores/pg.md) |
| `bus` | broker | — | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.cart
    participant p2 as cart-pg
    participant p3 as bus
    p0->>p1: createBasket
    p1->>p2: save
    p1-)p3: BasketCreated
    p1-->>p0: BasketCreated
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.cart** — createBasket
   `cart.v1/createBasket` · status: declared · [`examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts:33`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts#L33)
<a id="step-s2"></a>
2. **shop.cart** → **cart-pg** — save
   status: declared · [`examples/shop/cart/src/application/basket/usecases/create_basket/usecase.ts:22`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/create_basket/usecase.ts#L22)
<a id="step-s3"></a>
3. **shop.cart** → **bus** — BasketCreated
   [`shop.cart.basket.BasketCreated`](../shop/cart/aggregates/basket.md#event-shop-cart-basket-basketcreated) · status: declared · [`examples/shop/cart/src/application/basket/usecases/create_basket/usecase.ts:22`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/application/basket/usecases/create_basket/usecase.ts#L22)
<a id="step-response-s1"></a>
4. **shop.cart** → **client** — BasketCreated
   status: declared · Synthesized from the proven synchronous HTTP handler return.
