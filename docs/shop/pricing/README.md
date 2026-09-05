# Pricing

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `shop.pricing`
- **Context:** [Shop](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/shop/pricing`

Service `pricing` — bounded context **shop**. Go.

Owns what things cost. It is asked, and it answers with a promise: a quote is a
price for one basket, good until a moment, and after that moment it is gone
rather than stale.

## What it does

- Prices a basket against the list in force and issues a quote — `QuoteIssued`.
- Answers what a quote says, by its id or by the basket it priced.
- Lets promises lapse: the sweep expires everything past its moment, and a
  basket checked out has its quote expired straight away, because from then on
  the order holds the price.
- Takes in price lists whole and archives them rather than editing them, so
  that what a quote was priced against stays readable.

## What it does not do

Does not decide what to buy, does not hold a basket and does not place an
order. It never recomputes a price it has already promised — a quote that
changed under the customer would not be a quote.

## Publishes

`QuoteIssued`, `QuoteExpired`, on `shop.pricing.quote`.

## Provides

`shop.v1.Pricing` — IssueQuote, GetQuote — and `shop.v1.PriceLists` —
ImportPriceList, ArchivePriceList, ListPriceLists. One contract per aggregate,
vendored under the transport package that answers it.

`Pricing` keeps its name rather than taking the `Service` suffix the lint rules
want: `shop.cart` has been calling `shop.v1.Pricing/GetQuote` since before this
service existed, and a naming rule is not worth breaking a consumer over. The
exception is written down in the module's `buf.yaml`.

## Running it

```bash
docker compose up -d db
make gen && go run ./cmd/pricing
```

`make gen` regenerates the stubs from the contracts in this tree — one call per
module, into the `gen` directory beside the code that uses it.

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Price List](aggregates/price-list.md) | `PriceList` | 2 commands | 1 query | 0 events |
| [Quote](aggregates/quote.md) | `Quote` | 2 commands | 1 query | 2 events |

## Provides

**`shop.v1.Pricing`** — `examples/shop/pricing/internal/infrastructure/transport/grpc/quote/proto/shop/v1/pricing.proto:11`

- `IssueQuote`
- `GetQuote`

<details><summary>IssueQuoteRequest</summary>

| Field | Type |
| --- | --- |
| `basket_id` | `string` |
| `currency` | `string` |
| `items` | `[]Item` |

</details>

<details><summary>IssueQuoteResponse</summary>

| Field | Type |
| --- | --- |
| `quote_id` | `string` |
| `total_minor` | `int64` |
| `currency` | `string` |
| `expires_at` | `string` |

</details>

<details><summary>GetQuoteRequest</summary>

| Field | Type |
| --- | --- |
| `quote_id` | `string` |
| `basket_id` | `string` |

</details>

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

<details><summary>Item</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `int32` |

</details>

**`shop.v1.PriceLists`** — `examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/proto/shop/v1/price_lists.proto:9`

- `ImportPriceList`
- `ArchivePriceList`
- `ListPriceLists`

<details><summary>ImportPriceListRequest</summary>

| Field | Type |
| --- | --- |
| `name` | `string` |
| `currency` | `string` |
| `valid_from` | `string` |
| `rows` | `[]PriceRow` |

</details>

<details><summary>ImportPriceListResponse</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |
| `rows` | `int32` |

</details>

<details><summary>ArchivePriceListRequest</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |

</details>

<details><summary>ArchivePriceListResponse</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |

</details>

<details><summary>ListPriceListsRequest</summary>


</details>

<details><summary>ListPriceListsResponse</summary>

| Field | Type |
| --- | --- |
| `lists` | `[]PriceListSummary` |

</details>

<details><summary>PriceRow</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `amount_minor` | `int64` |

</details>

<details><summary>PriceListSummary</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |
| `name` | `string` |
| `currency` | `string` |
| `rows` | `int32` |
| `archived` | `bool` |

</details>

## Publishes

| Event | Latest |
| --- | --- |
| [QuoteExpired](aggregates/quote.md) | v1 |
| [QuoteIssued](aggregates/quote.md) | v1 |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Pricing database](stores/pg.md) | postgres | owns | 5 tables |
