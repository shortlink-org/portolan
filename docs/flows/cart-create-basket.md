# Create basket

*Generated from the portolan catalog · commit `5 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `flow.cart-create-basket`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts`

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
    p0->>p1: createBasket
    p1->>p2: save
    p1-)p3: BasketCreated
```

## Steps

1. **client** → **shop.cart** — createBasket
   `examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts:33` · Seen running in telemetry/traces.jsonl (2 traces).
2. **shop.cart** → **cart-pg** — save
   status: declared · `examples/shop/cart/src/application/basket/usecases/create_basket/usecase.ts:22`
3. **shop.cart** → **bus** — BasketCreated
   [shop.cart.basket.BasketCreated](../shop/cart/aggregates/basket.md) · `examples/shop/cart/src/application/basket/usecases/create_basket/usecase.ts:22` · Seen running in telemetry/traces.jsonl (2 traces).
