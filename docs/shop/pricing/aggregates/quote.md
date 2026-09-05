# Quote

*Generated from the portolan catalog · commit `9 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.pricing.quote`
- **Service:** [Pricing](../README.md)
- **Root:** `Quote`

What a basket costs, promised until a moment.

A quote is issued against a basket with its lines captured, and from then on it
only moves twice: it is taken by the order it priced, or it expires. The price
is never recomputed - a quote that changed under the customer would not be a
quote - and an expired one is not revived, it is replaced.

## Entities

### Quote — aggregate root

Quote is one basket, priced. The lines are captured at issue and never recomputed: a quote that changed under the customer would not be a quote.

| Field | Type |
| --- | --- |
| `id` | `string` |
| `basketID` | `string` |
| `lines` | `[]line.Line` |
| `total` | `money.Money` |
| `state` | `string` |
| `issuedAt` | `time.Time` |
| `expiresAt` | `time.Time` |

## Value objects

### Line

Line is a value: two lines with the same sku, quantity and price are the same line. The price is captured when the quote is issued and never recomputed - that is the whole point of quoting.

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `int32` |
| `unitPrice` | `money.Money` |

### Money

Money never rounds: everything is an integer of minor units, and two amounts are only added when they are in the same currency.

| Field | Type |
| --- | --- |
| `amountMinor` | `int64` |
| `currency` | `string` |

## Operations

| Operation | Kind | Exposed by | Doc |
| --- | --- | --- | --- |
| `ExpireQuote` | command | *internal* | Package expire_quote lets promises lapse. |
| `GetQuote` | query | `GetQuote` | Package get_quote reads one quote. |
| `IssueQuote` | command | `IssueQuote` | Package issue_quote prices a basket and promises the price for a while. |

## Events

### QuoteExpired

`shop.pricing.quote.QuoteExpired`

On the wire as `pricing.QuoteExpired`, on `shop.pricing.quote`.

#### v1 — current

QuoteExpired says the price is no longer promised. Nothing is refunded and nothing is cancelled: whoever holds the quote has to ask for another one.

Source: `examples/shop/pricing/internal/domain/quote/event/quote_expired.go`

| Field | Type |
| --- | --- |
| `quoteID` | `string` |
| `basketID` | `string` |
| `occurredAt` | `time.Time` |

### QuoteIssued

`shop.pricing.quote.QuoteIssued`

On the wire as `pricing.QuoteIssued`, on `shop.pricing.quote`.

#### v1 — current

QuoteIssued says a basket has a price, and for how long. Whoever places the order needs both, so both are on the event rather than fetched again.

Source: `examples/shop/pricing/internal/domain/quote/event/quote_issued.go`

| Field | Type |
| --- | --- |
| `quoteID` | `string` |
| `basketID` | `string` |
| `totalMinor` | `int64` |
| `currency` | `string` |
| `expiresAt` | `time.Time` |
| `occurredAt` | `time.Time` |
