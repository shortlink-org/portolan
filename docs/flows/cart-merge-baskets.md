# Merge baskets

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.cart-merge-baskets`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts`

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.cart` | service | [shop](../shop/README.md) |
| `auth.auth` | service | [auth](../auth/README.md) |
| `cart-pg` | store | [shop](../shop/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.cart
    participant p2 as auth.auth
    participant p3 as cart-pg
    participant p4 as bus
    p0->>p1: mergeBaskets → Basket
    p1->>p2: validateSession → SessionInfo
    p1->>p3: openFor
    p1->>p3: save
    p1-)p4: BasketCreated
    p1-)p4: BasketItemAdded
    p1->>p3: save
    p1-)p4: BasketMerged
```

## Steps

1. **client** → **shop.cart** — mergeBaskets → Basket
   `examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts:54` · Seen running in telemetry/traces.jsonl (1 trace).
2. **shop.cart** → **auth.auth** — validateSession → SessionInfo
   `auth.v1.Sessions/validateSession` · `examples/shop/cart/src/application/basket/usecases/merge_baskets/usecase.ts:28` · Seen running in telemetry/traces.jsonl (1 trace).
3. **shop.cart** → **cart-pg** — openFor
   status: declared · `examples/shop/cart/src/application/basket/usecases/merge_baskets/usecase.ts:35`
4. **shop.cart** → **cart-pg** — save
   status: declared · `examples/shop/cart/src/application/basket/usecases/merge_baskets/usecase.ts:46`
5. **shop.cart** → **bus** — BasketCreated
   [shop.cart.basket.BasketCreated](../shop/cart/aggregates/basket.md) · `examples/shop/cart/src/application/basket/usecases/merge_baskets/usecase.ts:46` · Seen running in telemetry/traces.jsonl (1 trace).
6. **shop.cart** → **bus** — BasketItemAdded
   [shop.cart.basket.BasketItemAdded](../shop/cart/aggregates/basket.md) · `examples/shop/cart/src/application/basket/usecases/merge_baskets/usecase.ts:46` · Seen running in telemetry/traces.jsonl (1 trace).
7. **shop.cart** → **cart-pg** — save
   status: declared · `examples/shop/cart/src/application/basket/usecases/merge_baskets/usecase.ts:47`
8. **shop.cart** → **bus** — BasketMerged
   [shop.cart.basket.BasketMerged](../shop/cart/aggregates/basket.md) · `examples/shop/cart/src/application/basket/usecases/merge_baskets/usecase.ts:47` · Seen running in telemetry/traces.jsonl (1 trace).
