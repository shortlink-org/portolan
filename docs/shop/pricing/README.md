# Pricing

*Generated from the portolan catalog · commit `11 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `shop.pricing`
- **Context:** [Shop](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`examples/shop/pricing/`](https://github.com/shortlink-org/portolan/tree/main/examples/shop/pricing)
- **Owners:** `@shortlink-org/shop`

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

`QuoteIssued`, `QuoteExpired`, on `shop.pricing.quote`. Each is written to the
outbox in the transaction that raised it, and the relay hands the row to the
bus.

## Listens

`cart.BasketCheckedOut`, on `shop.cart.basket`: the quote the basket was priced
with is expired straight away, because from checkout on the order holds the
price.

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
docker compose up -d db nats
make gen && NATS_URL=nats://localhost:4222 go run ./cmd/pricing
```

`make gen` regenerates the stubs from the contracts in this tree — one call per
module, into the `gen` directory beside the code that uses it. Without
`NATS_URL` the service still runs: what it would have published goes to the
log, and nothing arrives.

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Price List](aggregates/price-list.md) | `PriceList` | 2 commands | 1 query | 0 events |
| [Quote](aggregates/quote.md) | `Quote` | 2 commands | 1 query | 2 events |

## Provides

### shop.v1.PriceLists

- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/proto/shop/v1/price_lists.proto:9`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/proto/shop/v1/price_lists.proto#L9)
- **Module:** [buf.build/shortlink-org/portolan-shop-price-list](../../modules/shortlink-org-portolan-shop-price-list.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `ArchivePriceList` | `ArchivePriceListRequest` | `ArchivePriceListResponse` | Take a list out of use without losing it. |
| `ImportPriceList` | `ImportPriceListRequest` | `ImportPriceListResponse` | Take in a whole list. |
| `ListPriceLists` | `ListPriceListsRequest` | `ListPriceListsResponse` | Every list there is, archived ones included. |

<a id="message-archivepricelistrequest"></a>
<details><summary>ArchivePriceListRequest</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |

</details>

<a id="message-archivepricelistresponse"></a>
<details><summary>ArchivePriceListResponse</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |

</details>

<a id="message-importpricelistrequest"></a>
<details><summary>ImportPriceListRequest</summary>

| Field | Type |
| --- | --- |
| `name` | `string` |
| `currency` | `string` |
| `valid_from` | `string` |
| `rows` | `[]PriceRow` |

</details>

<a id="message-importpricelistresponse"></a>
<details><summary>ImportPriceListResponse</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |
| `rows` | `int32` |

</details>

<a id="message-listpricelistsrequest"></a>
<details><summary>ListPriceListsRequest</summary>


</details>

<a id="message-listpricelistsresponse"></a>
<details><summary>ListPriceListsResponse</summary>

| Field | Type |
| --- | --- |
| `lists` | `[]PriceListSummary` |

</details>

<a id="message-pricelistsummary"></a>
<details><summary>PriceListSummary</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |
| `name` | `string` |
| `currency` | `string` |
| `rows` | `int32` |
| `archived` | `bool` |

</details>

<a id="message-pricerow"></a>
<details><summary>PriceRow</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `amount_minor` | `int64` |

</details>

### shop.v1.Pricing

- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/quote/proto/shop/v1/pricing.proto:11`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/proto/shop/v1/pricing.proto#L11)
- **Module:** [buf.build/shortlink-org/portolan-shop-quote](../../modules/shortlink-org-portolan-shop-quote.md)

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

## Publishes

| Event | Latest |
| --- | --- |
| [`QuoteExpired`](aggregates/quote.md#event-shop-pricing-quote-quoteexpired) | v1 |
| [`QuoteIssued`](aggregates/quote.md#event-shop-pricing-quote-quoteissued) | v1 |

## Channels

### shop.cart.basket

**JetStream subject**

Read through github.com/nats-io/nats.go. Subscribed by `NATS.Subscribe` over JetStream.

Source: [`internal/di/app.go:67`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/di/app.go#L67)

| Direction | Message | Title |
| --- | --- | --- |
| receive | [`cart.BasketCheckedOut`](../cart/aggregates/basket.md#event-shop-cart-basket-basketcheckedout) | cart.BasketCheckedOut |

## Schema modules

| Module | Access | Packages |
| --- | --- | --- |
| [shortlink-org/portolan-shop-price-list](../../modules/shortlink-org-portolan-shop-price-list.md) | publishes | shop.v1 |
| [shortlink-org/portolan-shop-quote](../../modules/shortlink-org-portolan-shop-quote.md) | publishes | shop.v1 |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Pricing database](stores/pg.md) | postgres | owns | 5 tables |
