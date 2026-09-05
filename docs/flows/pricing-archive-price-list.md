# Archive price list

*Generated from the portolan catalog · commit `9 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `flow.pricing-archive-price-list`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go`

Package archive_price_list takes a price list out of use without losing it.

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
    p0->>p1: ArchivePriceList → ArchivePriceListResponse
    p1->>p2: ByID
    p1->>p2: Save
```

## Steps

1. **client** → **shop.pricing** — ArchivePriceList → ArchivePriceListResponse
   status: declared · `examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go:50`
2. **shop.pricing** → **pricing-pg** — ByID
   status: declared · `examples/shop/pricing/internal/application/price_list/usecases/archive_price_list/usecase.go:22`
3. **shop.pricing** → **pricing-pg** — Save
   status: declared · `examples/shop/pricing/internal/application/price_list/usecases/archive_price_list/usecase.go:28`
