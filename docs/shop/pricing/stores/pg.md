# Pricing database

*Generated from the portolan catalog · commit `7 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.pricing.pg`
- **Kind:** postgres
- **Owner:** [shop.pricing](../README.md)
- **Source:** `examples/shop/pricing/internal/infrastructure/repository`

## Tables

### price_lists

aggregate-root · persists [shop.pricing.price-list](../aggregates/price-list.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `text` | not null | PK |
| `name` | `text` | not null | — |
| `currency` | `char(3)` | not null | — |
| `valid_from` | `timestamptz` | not null | — |
| `archived` | `boolean` | not null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `price_lists_in_force` | currency, valid_from | index |

### price_rows

child · persists [shop.pricing.price-list](../aggregates/price-list.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `price_list_id` | `text` | not null | PK |
| `sku` | `text` | not null | PK |
| `amount_minor` | `bigint` | not null | — |

### quotes

aggregate-root · persists [shop.pricing.quote](../aggregates/quote.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `text` | not null | PK |
| `basket_id` | `text` | not null | — |
| `total_minor` | `bigint` | not null | — |
| `currency` | `char(3)` | not null | — |
| `state` | `text` | not null | — |
| `issued_at` | `timestamptz` | not null | — |
| `expires_at` | `timestamptz` | not null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `quotes_open_by_expiry` | state, expires_at | index |
| `quotes_by_basket` | basket_id | index |

### quote_lines

child · persists [shop.pricing.quote](../aggregates/quote.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `quote_id` | `text` | not null | PK |
| `sku` | `text` | not null | PK |
| `quantity` | `integer` | not null | — |
| `unit_price_minor` | `bigint` | not null | — |
| `currency` | `char(3)` | not null | — |

### outbox

outbox

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK |
| `topic` | `text` | not null | — |
| `name` | `text` | not null | — |
| `aggregate_id` | `text` | not null | — |
| `occurred_at` | `timestamptz` | not null | — |
| `published_at` | `timestamptz` | null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `outbox_unpublished` | id | index |

## Views

### v_price_list_use

computed on read · reads [`shop.pricing.pg.price_lists`](pg.md#price_lists), [`shop.pricing.pg.price_rows`](pg.md#price_rows)

| Column | Type | Null | From |
| --- | --- | --- | --- |
| `price_list_id` | `text` | not null | `shop.pricing.pg.price_lists.id` |
| `name` | `text` | not null | `shop.pricing.pg.price_lists.name` |
| `currency` | `char(3)` | not null | `shop.pricing.pg.price_lists.currency` |
| `rows_priced` | `text` | not null | `shop.pricing.pg.price_rows.sku` |

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

Source: `internal/infrastructure/repository/price_list/migrations/0002_price_list_use.sql`
