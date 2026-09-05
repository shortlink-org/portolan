# Order database

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `shop.oms.pg`
- **Kind:** postgres
- **Owner:** [shop.oms](../README.md)
- **Source:** `examples/shop/oms/src/infrastructure/repository`

## Tables

### orders

aggregate-root · persists [shop.oms.order](../aggregates/order.md)

| Column | Type | Null | Key | Maps | From |
| --- | --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Order.id | — |
| `customer_id` | `text` | not null | — | Order.customer_id | — |
| `basket_id` | `text` | not null | — | Order.basket_id | `shop.cart.pg.baskets.id` |
| `status` | `text` | not null | — | Order.status | — |
| `total_minor` | `bigint` | not null | — | Order.total.amount_minor | — |
| `currency` | `text` | not null | — | Order.total.currency | — |
| `placed_at` | `timestamptz` | not null | — | Order.placed_at | — |
| `version` | `integer` | not null | — | — | — |

### order_lines

child · persists [shop.oms.order](../aggregates/order.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `order_id` | `text` | not null | PK | Order.id |
| `sku` | `text` | not null | PK | Order.sku |
| `quantity` | `integer` | not null | — | — |
| `unit_price_minor` | `bigint` | not null | — | Order.unit_price.amount_minor |
| `currency` | `text` | not null | — | Order.unit_price.currency |

### outbox

outbox

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK |
| `uuid` | `text` | not null | — |
| `topic` | `text` | not null | — |
| `payload` | `jsonb` | not null | — |
| `metadata` | `jsonb` | not null | — |
| `created_at` | `timestamptz` | not null | — |
| `published_at` | `timestamptz` | null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `outbox_unpublished` | id | index |
