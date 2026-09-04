# Import price list

*Generated from the portolan catalog · commit `8 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `flow.pricing-import-price-list`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go`

Package import_price_list takes in a whole price list.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.pricing` | service | [shop](../shop/README.md) |
| `pricing-pg` | store | [shop](../shop/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.pricing
    participant p2 as pricing-pg
    p0->>p1: ImportPriceList → ImportPriceListResponse
    p1->>p2: Save
```

## Steps

1. **client** → **shop.pricing** — ImportPriceList → ImportPriceListResponse
   status: declared · `examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go:30`
2. **shop.pricing** → **pricing-pg** — Save
   status: declared · `examples/shop/pricing/internal/application/price_list/usecases/import_price_list/usecase.go:43`
