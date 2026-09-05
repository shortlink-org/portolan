# Mutation remove item

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `flow.bff-mutation-remove-item`
- **Owner:** [storefront](../storefront/README.md)
- **Source:** `examples/bff/src/schema/basket/resolvers/Mutation/removeItem.ts`

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
    p0->>p1: Mutation.removeItem → Basket
    p1->>p2: removeItem → Basket
```

## Steps

1. **client** → **storefront.bff** — Mutation.removeItem → Basket
   status: declared · `examples/bff/src/schema/basket/resolvers/Mutation/removeItem.ts:3`
2. **storefront.bff** → **shop.cart** — removeItem → Basket
   `cart.v1.Baskets/removeItem` · status: declared · `examples/bff/src/schema/basket/resolvers/Mutation/removeItem.ts:4`
