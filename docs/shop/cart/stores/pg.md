# Cart database

*Generated from the portolan catalog · commit `13 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `shop.cart.pg`
- **Kind:** postgres
- **Owner:** [shop.cart](../README.md)
- **Source:** [`examples/shop/cart/src/infrastructure/repository`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/cart/src/infrastructure/repository)

## Tables

<a id="relation-shop-cart-pg-baskets"></a>
### baskets

aggregate-root · persists [shop.cart.basket](../aggregates/basket.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | not null | PK | Basket.id |
| `token` | `text` | not null | — | Basket.token |
| `customer_id` | `text` | null | — | Basket.customerId |
| `currency` | `char(3)` | null | — | Basket.currency.code |
| `status` | `text` | not null | — | Basket.status |
| `touched_at` | `timestamptz` | not null | — | Basket.touchedAt |
| `version` | `integer` | not null | — | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `baskets_open_by_customer` | customer_id | index |
| `baskets_idle` | touched_at | index |

<a id="relation-shop-cart-pg-basket-items"></a>
### basket_items

child · persists [shop.cart.basket](../aggregates/basket.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `basket_id` | `uuid` | not null | PK | Basket.id |
| `sku` | `text` | not null | PK | Basket.items.sku |
| `quantity` | `integer` | not null | — | Basket.items.quantity |
| `unit_price_minor` | `bigint` | not null | — | Basket.items.unitPrice.amountMinor |
| `currency` | `char(3)` | not null | — | Basket.items.unitPrice.currency.code |

<a id="relation-shop-cart-pg-outbox"></a>
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
