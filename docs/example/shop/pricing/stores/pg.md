# Pricing database

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `shop.pricing.pg`
- **Kind:** postgres
- **Owner:** [shop.pricing](../README.md)
- **Source:** [`examples/shop/pricing/internal/infrastructure/repository`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository)

## Tables

<a id="relation-shop-pricing-pg-price-lists"></a>
### price_lists

aggregate-root · persists [shop.pricing.price-list](../aggregates/price-list.md)

| Access | Method | Source |
| --- | --- | --- |
| read | `Repository.All` | [`examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go:70`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go#L70) |
| read | `Repository.ByID` | [`examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go:56`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go#L56) |
| read | `Repository.Current` | [`examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go:62`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go#L62) |
| write | `Repository.Save` | [`examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go:33`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go#L33) |

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | PriceList.id |
| `name` | `text` | not null | — | PriceList.name |
| `currency` | `char(3)` | not null | — | PriceList.currency |
| `valid_from` | `timestamptz` | not null | — | PriceList.validFrom |
| `archived` | `boolean` | not null | — | PriceList.archived |

| Index | Columns | Kind |
| --- | --- | --- |
| `price_lists_in_force` | currency, valid_from | index |

<a id="relation-shop-pricing-pg-price-rows"></a>
### price_rows

child · persists [shop.pricing.price-list](../aggregates/price-list.md)

| Access | Method | Source |
| --- | --- | --- |
| read | `Repository.ByID` | [`examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go:103`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go#L103) |
| read | `Repository.Current` | [`examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go:103`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go#L103) |
| write | `Repository.Save` | [`examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go:43`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/repository.go#L43) |

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `price_list_id` | `text` | not null | PK | PriceList.id |
| `sku` | `text` | not null | PK | PriceList.rows.sku |
| `amount_minor` | `bigint` | not null | — | PriceList.rows.price |

<a id="relation-shop-pricing-pg-quotes"></a>
### quotes

aggregate-root · persists [shop.pricing.quote](../aggregates/quote.md)

| Access | Method | Source |
| --- | --- | --- |
| read | `Repository.ByBasket` | [`examples/shop/pricing/internal/infrastructure/repository/quote/repository.go:83`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/quote/repository.go#L83) |
| read | `Repository.ByID` | [`examples/shop/pricing/internal/infrastructure/repository/quote/repository.go:79`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/quote/repository.go#L79) |
| read | `Repository.OpenBefore` | [`examples/shop/pricing/internal/infrastructure/repository/quote/repository.go:91`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/quote/repository.go#L91) |
| write | `Repository.Save` | [`examples/shop/pricing/internal/infrastructure/repository/quote/repository.go:40`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/quote/repository.go#L40) |

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Quote.id |
| `basket_id` | `text` | not null | — | Quote.basketID |
| `total_minor` | `bigint` | not null | — | Quote.total |
| `currency` | `char(3)` | not null | — | Quote.total |
| `state` | `text` | not null | — | Quote.state |
| `issued_at` | `timestamptz` | not null | — | Quote.issuedAt |
| `expires_at` | `timestamptz` | not null | — | Quote.expiresAt |

| Index | Columns | Kind |
| --- | --- | --- |
| `quotes_open_by_expiry` | state, expires_at | index |
| `quotes_by_basket` | basket_id | index |

<a id="relation-shop-pricing-pg-quote-lines"></a>
### quote_lines

child · persists [shop.pricing.quote](../aggregates/quote.md)

| Access | Method | Source |
| --- | --- | --- |
| write | `Repository.Save` | [`examples/shop/pricing/internal/infrastructure/repository/quote/repository.go:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/quote/repository.go#L50) |

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `quote_id` | `text` | not null | PK | Quote.id |
| `sku` | `text` | not null | PK | Quote.lines.sku |
| `quantity` | `integer` | not null | — | Quote.lines.quantity |
| `unit_price_minor` | `bigint` | not null | — | Quote.lines.unitPrice |
| `currency` | `char(3)` | not null | — | Quote.lines.unitPrice |

<a id="relation-shop-pricing-pg-outbox"></a>
### outbox

outbox

| Access | Method | Source |
| --- | --- | --- |
| write | `Repository.Save` | [`examples/shop/pricing/internal/infrastructure/repository/quote/repository.go:65`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/quote/repository.go#L65) |

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK |
| `topic` | `text` | not null | — |
| `name` | `text` | not null | — |
| `aggregate_id` | `text` | not null | — |
| `occurred_at` | `timestamptz` | not null | — |
| `published_at` | `timestamptz` | null | — |
| `uuid` | `text` | not null | — |
| `payload` | `jsonb` | not null | — |
| `metadata` | `jsonb` | not null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `outbox_unpublished` | id | index |
| `outbox_by_uuid` | uuid | unique |

## Views

<a id="relation-shop-pricing-pg-v-price-list-use"></a>
### v_price_list_use

computed on read · reads [`shop.pricing.pg.price_lists`](pg.md#relation-shop-pricing-pg-price-lists), [`shop.pricing.pg.price_rows`](pg.md#relation-shop-pricing-pg-price-rows)

| Column | Type | Null | Maps | From |
| --- | --- | --- | --- | --- |
| `price_list_id` | `text` | not null | PriceList.ID | `shop.pricing.pg.price_lists.id` |
| `name` | `text` | not null | PriceList.Name | `shop.pricing.pg.price_lists.name` |
| `currency` | `char(3)` | not null | PriceList.Currency | `shop.pricing.pg.price_lists.currency` |
| `rows_priced` | `text` | not null | PriceList.Rows.SKU | `shop.pricing.pg.price_rows.sku` |

```sql
CREATE VIEW v_price_list_use AS
SELECT l.id        AS price_list_id,
       l.name      AS name,
       l.currency  AS currency,
       count(r.sku) AS rows_priced
  FROM price_lists l
  LEFT JOIN price_rows r ON r.price_list_id = l.id
 GROUP BY l.id;
```

Source: [`internal/infrastructure/repository/price_list/migrations/0002_price_list_use.sql`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/repository/price_list/migrations/0002_price_list_use.sql)
