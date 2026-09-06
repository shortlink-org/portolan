# Issue quote

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.pricing-issue-quote`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go)

Package issue_quote prices a basket and promises the price for a while.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.pricing` | service | [shop](../shop/README.md) |
| `pricing-pg` | store | [shop](../shop/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.pricing
    participant p2 as pricing-pg
    participant p3 as bus
    p0->>p1: IssueQuote → IssueQuoteResponse
    p1->>p2: Current
    p1->>p2: Save
    p1-)p3: QuoteIssued
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.pricing** — IssueQuote → IssueQuoteResponse
   status: declared · [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go:28`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/handler.go#L28)
<a id="step-s2"></a>
2. **shop.pricing** → **pricing-pg** — Current
   status: declared · [`examples/shop/pricing/internal/application/quote/usecases/issue_quote/usecase.go:35`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/issue_quote/usecase.go#L35)
<a id="step-s3"></a>
3. **shop.pricing** → **pricing-pg** — Save
   status: declared · [`examples/shop/pricing/internal/application/quote/usecases/issue_quote/usecase.go:55`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/issue_quote/usecase.go#L55)
<a id="step-s4"></a>
4. **shop.pricing** → **bus** — QuoteIssued
   [`shop.pricing.quote.QuoteIssued`](../shop/pricing/aggregates/quote.md#event-shop-pricing-quote-quoteissued) · status: declared · [`examples/shop/pricing/internal/application/quote/usecases/issue_quote/usecase.go:55`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/application/quote/usecases/issue_quote/usecase.go#L55)
