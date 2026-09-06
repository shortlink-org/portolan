# shortlink-org/portolan-shop-quote

*Generated from the portolan catalog · commit `11 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `buf.build/shortlink-org/portolan-shop-quote`
- **Registry:** buf.build
- **Publisher:** [shop.pricing](../shop/pricing/README.md)
- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/proto)

## Packages

| Package |
| --- |
| `shop.v1` |

## Files

| File |
| --- |
| [`shop/v1/pricing.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/shop/v1/pricing.proto) |

## Used by

| Service | Access |
| --- | --- |
| [Pricing](../shop/pricing/README.md) | publishes |

## Interfaces

### shop.v1.Pricing

- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/proto/shop/v1/pricing.proto:11`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/proto/shop/v1/pricing.proto#L11)
- **Module:** [buf.build/shortlink-org/portolan-shop-quote](shortlink-org-portolan-shop-quote.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `GetQuote` | `GetQuoteRequest` | `GetQuoteResponse` | Read a quote, by its own id or by the basket it priced. |
| `IssueQuote` | `IssueQuoteRequest` | `IssueQuoteResponse` | Price a basket and promise the price for a window. |

<a id="message-getquoterequest"></a>
<details><summary>GetQuoteRequest</summary>

| Field | Type |
| --- | --- |
| `quote_id` | `string` |
| `basket_id` | `string` |

</details>

<a id="message-getquoteresponse"></a>
<details><summary>GetQuoteResponse</summary>

| Field | Type |
| --- | --- |
| `quote_id` | `string` |
| `basket_id` | `string` |
| `total_minor` | `int64` |
| `currency` | `string` |
| `state` | `string` |
| `expires_at` | `string` |

</details>

<a id="message-issuequoterequest"></a>
<details><summary>IssueQuoteRequest</summary>

| Field | Type |
| --- | --- |
| `basket_id` | `string` |
| `currency` | `string` |
| `items` | `[]Item` |

</details>

<a id="message-issuequoteresponse"></a>
<details><summary>IssueQuoteResponse</summary>

| Field | Type |
| --- | --- |
| `quote_id` | `string` |
| `total_minor` | `int64` |
| `currency` | `string` |
| `expires_at` | `string` |

</details>

<a id="message-item"></a>
<details><summary>Item</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `int32` |

</details>
