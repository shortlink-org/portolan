# Get quote

*Generated from the portolan catalog · commit `11 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.pricing-get-quote`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go)

Package get_quote reads one quote.

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
   status: declared · [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go:52`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go#L52)

> **One of**
>
> *in.QuoteID != ""*
>
> <a id="step-s2"></a>
> 2. **shop.pricing** → **pricing-pg** — ByID
>    status: declared · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:27`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L27)
>
> *otherwise*
>
> <a id="step-s3"></a>
> 3. **shop.pricing** → **pricing-pg** — ByBasket
>    status: declared · [`examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go:29`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/get_quote/usecase.go#L29)
