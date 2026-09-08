# Mutation checkout

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.bff-mutation-checkout`
- **Owner:** [storefront](../storefront/README.md)
- **Source:** [`examples/bff/src/schema/basket/resolvers/Mutation/checkout.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/basket/resolvers/Mutation/checkout.ts)

Freeze the basket and hand it on.

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
    p0->>p1: Mutation.checkout → Checkout
    p1->>p2: checkout
```

## Steps

<a id="step-s1"></a>
1. **client** → **storefront.bff** — Mutation.checkout → Checkout
   status: declared · [`examples/bff/src/schema/basket/resolvers/Mutation/checkout.ts:11`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/basket/resolvers/Mutation/checkout.ts#L11)
<a id="step-s2"></a>
2. **storefront.bff** → **shop.cart** — checkout
   `cart.v1.Baskets/checkout` · status: declared · [`examples/bff/src/schema/basket/resolvers/Mutation/checkout.ts:12`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/basket/resolvers/Mutation/checkout.ts#L12)
