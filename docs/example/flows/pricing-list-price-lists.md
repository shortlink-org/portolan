# List price lists

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.pricing-list-price-lists`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go)

Package list_price_lists reads every price list there is.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `shop.pricing` | service | [shop](../shop/README.md) | — |
| `pricing-pg` | store | [shop](../shop/README.md) | [shop.pricing.pg](../shop/pricing/stores/pg.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.pricing
    participant p2 as pricing-pg
    p0->>p1: ListPriceLists → ListPriceListsResponse
    p1->>p2: All
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.pricing** — ListPriceLists → ListPriceListsResponse
   `shop.v1.PriceLists/ListPriceLists` · status: declared · [`examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go:60`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go#L60) · evidence: call-site · source-expression · `ListPriceLists` · [`examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go:60`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/handler.go#L60)
<a id="step-s2"></a>
2. **shop.pricing** → **pricing-pg** — All
   status: declared · [`examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go:22`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go#L22) · store: [shop.pricing.pg](../shop/pricing/stores/pg.md) · `All` · evidence: function · source-function · `examples/shop/pricing/internal/application/price_list/usecases/list_price_lists:UseCase.Handle` · [`examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go:21`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go#L21) · evidence: binding · domain-port-convention · `price_list.Repository` · [`examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go:22`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go#L22) · evidence: call-site · source-expression · `All` · [`examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go:22`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/usecase.go#L22)
