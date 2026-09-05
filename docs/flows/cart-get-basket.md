# Get basket

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `flow.cart-get-basket`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts`

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.cart` | service | [shop](../shop/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.cart
    p0->>p1: getBasket → Basket
```

## Steps

1. **client** → **shop.cart** — getBasket → Basket
   `examples/shop/cart/src/infrastructure/transport/http/basket/handlers.ts:38` · Seen running in telemetry/traces.jsonl (2 traces).
