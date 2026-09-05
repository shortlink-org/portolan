# Query basket

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `flow.bff-query-basket`
- **Owner:** [storefront](../storefront/README.md)
- **Source:** `examples/bff/src/schema/basket/resolvers/Query/basket.ts`

The basket as the cart has it, in the storefront's words.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `storefront.bff` | service | [storefront](../storefront/README.md) |
| `shop.cart` | service | [shop](../shop/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as storefront.bff
    participant p2 as shop.cart
    p0->>p1: Query.basket → Basket
    p1->>p2: getBasket → Basket
```

## Steps

1. **client** → **storefront.bff** — Query.basket → Basket
   status: declared · `examples/bff/src/schema/basket/resolvers/Query/basket.ts:4`
2. **storefront.bff** → **shop.cart** — getBasket → Basket
   `cart.v1.Baskets/getBasket` · status: declared · `examples/bff/src/schema/basket/resolvers/Query/basket.ts:5`
