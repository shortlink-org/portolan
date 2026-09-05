# Cart database

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `shop.cart.pg`
- **Kind:** postgres
- **Owner:** [shop.cart](../README.md)
- **Source:** `examples/shop/cart/src/infrastructure/repository`

## Tables

### baskets

aggregate-root · persists [shop.cart.basket](../aggregates/basket.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | not null | PK | Basket.id |
| `token` | `text` | not null | — | Basket.token |
| `customer_id` | `text` | null | — | — |
| `currency` | `char(3)` | null | — | — |
| `status` | `text` | not null | — | Basket.status |
| `touched_at` | `timestamptz` | not null | — | Basket.touchedAt |
| `version` | `integer` | not null | — | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `baskets_open_by_customer` | customer_id | index |
| `baskets_idle` | touched_at | index |

### basket_items

child · persists [shop.cart.basket](../aggregates/basket.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `basket_id` | `uuid` | not null | PK | Basket.id |
| `sku` | `text` | not null | PK | Basket.sku |
| `quantity` | `integer` | not null | — | Basket.quantity |
| `unit_price_minor` | `bigint` | not null | — | Basket.unitPrice.amountMinor |
| `currency` | `char(3)` | not null | — | Basket.unitPrice.currency.code |

### outbox

outbox

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK |
| `uuid` | `uuid` | not null | — |
| `topic` | `text` | not null | — |
| `payload` | `jsonb` | not null | — |
| `metadata` | `jsonb` | not null | — |
| `created_at` | `timestamptz` | not null | — |
| `published_at` | `timestamptz` | null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `outbox_unpublished` | id | index |
