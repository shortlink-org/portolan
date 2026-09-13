# Get quote

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.pricing-get-quote`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `callback` · gRPC · GetQuote
- **Root confidence:** high
- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go)

Package get_quote reads one quote.

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
    p0->>p1: GetQuote → GetQuoteResponse
    alt in.QuoteID != ""
        p1->>p2: ByID
    else otherwise
        p1->>p2: ByBasket
    end
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.pricing** — GetQuote → GetQuoteResponse
   `shop.v1.Pricing/GetQuote` · status: declared · [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go:52`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go#L52) · evidence: call-site · source-expression · `GetQuote` · [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go:52`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go#L52)

> **One of**
>
> *in.QuoteID != ""*
>
> <a id="step-s2"></a>
> 2. **shop.pricing** → **pricing-pg** — ByID
>    status: declared · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:27`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L27) · store: [shop.pricing.pg](../shop/pricing/stores/pg.md) · `ByID` · evidence: function · source-function · `examples/shop/pricing/internal/application/quote/usecases/get_quote:UseCase.Handle` · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:21`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L21) · evidence: binding · domain-port-convention · `quote.Repository` · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:27`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L27) · evidence: call-site · source-expression · `ByID` · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:27`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L27)
>
> *otherwise*
>
> <a id="step-s3"></a>
> 3. **shop.pricing** → **pricing-pg** — ByBasket
>    status: declared · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:29`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L29) · store: [shop.pricing.pg](../shop/pricing/stores/pg.md) · `ByBasket` · evidence: function · source-function · `examples/shop/pricing/internal/application/quote/usecases/get_quote:UseCase.Handle` · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:21`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L21) · evidence: binding · domain-port-convention · `quote.Repository` · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:29`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L29) · evidence: call-site · source-expression · `ByBasket` · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:29`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L29)
