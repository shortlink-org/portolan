# Order management database

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.oms.pg`
- **Kind:** postgres
- **Owner:** [shop.oms](../README.md)
- **Source:** `shop/oms/db/migrations`

## Tables

### orders

aggregate-root · persists [shop.oms.order](../aggregates/order.md)

One row per order. The row lock taken here is the aggregate boundary.

| Column | Type | Null | Key | Maps | Doc |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | not null | PK | Order.id | Order identity, generated on placement. |
| `status` | `text` | not null | — | Order.status | — |
| `customer_id` | `uuid` | not null | — | Order.customer | — |
| `total_minor` | `bigint` | not null | — | Order.total | — |
| `currency` | `char(3)` | not null | — | Order.currency | — |
| `ship_to` | `jsonb` | not null | — | Order.shipTo | — |
| `risk` | `jsonb` | null | — | Order.risk | — |
| `placed_at` | `timestamptz` | not null | — | — | — |
| `updated_at` | `timestamptz` | not null | — | — | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `orders_status_placed_at_idx` | status, placed_at | index |
| `orders_customer_idx` | customer_id | index |

### order_items

child · persists [shop.oms.order](../aggregates/order.md) · block `shop.oms.order.order-line`

Lines of an order, keyed inside it. Nothing outside the aggregate points here.

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `order_id` | `uuid` | not null | PK | — |
| `line_no` | `integer` | not null | PK | OrderLine.lineNo |
| `sku` | `text` | not null | — | OrderLine.sku |
| `quantity` | `bigint` | not null | — | OrderLine.quantity |
| `unit_price_minor` | `bigint` | not null | — | OrderLine.unitPrice |

### outbox

outbox

Events committed with the state change that produced them.

| Column | Type | Null | Key | From | Doc |
| --- | --- | --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK | — | — |
| `aggregate_id` | `uuid` | not null | — | `shop.oms.pg.orders.id` | The order the event is about. Copied from orders.id in the same transaction. |
| `event_type` | `text` | not null | — | — | The event name, as published. |
| `payload` | `jsonb` | not null | — | — | The event body, exactly as published. |
| `created_at` | `timestamptz` | not null | — | — | — |
| `published_at` | `timestamptz` | null | — | — | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `outbox_unpublished_idx` | published_at | index |

### price_snapshots

persists [shop.pricing.quote](../../pricing/aggregates/quote.md)

Quotes as pricing left them. Written by shop.pricing, not by this service.

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `quote_id` | `text` | not null | PK | Quote.id |
| `basket_id` | `text` | not null | — | Quote.basketId |
| `total_minor` | `bigint` | not null | — | Quote.total |
| `captured_at` | `timestamptz` | not null | — | — |

## Views

### v_open_orders

computed on read · reads [`shop.oms.pg.orders`](pg.md#orders), [`shop.oms.pg.order_items`](pg.md#order_items)

Orders not yet delivered, with their line count. What the ops console reads.

| Column | Type | Null | Maps | From | Doc |
| --- | --- | --- | --- | --- | --- |
| `order_id` | `uuid` | not null | Order.id | `shop.oms.pg.orders.id` | — |
| `status` | `text` | not null | Order.status | `shop.oms.pg.orders.status` | — |
| `customer_id` | `uuid` | not null | Order.customer | `shop.oms.pg.orders.customer_id` | — |
| `total_minor` | `bigint` | not null | Order.total | `shop.oms.pg.orders.total_minor` | — |
| `placed_at` | `timestamptz` | not null | — | `shop.oms.pg.orders.placed_at` | — |
| `line_count` | `bigint` | not null | — | `shop.oms.pg.order_items.line_no` | count(*) over the order's lines, so it is a number where the source is a key. |

```sql
CREATE VIEW v_open_orders AS
SELECT o.id AS order_id, o.status, o.customer_id, o.total_minor,
       o.placed_at, count(i.line_no) AS line_count
  FROM orders o
  LEFT JOIN order_items i ON i.order_id = o.id
 WHERE o.status <> 'delivered'
 GROUP BY o.id;
```

Source: `shop/oms/db/migrations/0007_open_orders.sql`

### mv_orders_daily

**materialized** — rows are stored, and can be stale · reads [`shop.oms.pg.v_open_orders`](pg.md#v_open_orders)

Yesterday's order volume, refreshed nightly. Stale by design between refreshes.

| Column | Type | Null | From | Doc |
| --- | --- | --- | --- | --- |
| `day` | `timestamptz` | not null | `shop.oms.pg.v_open_orders.placed_at` | — |
| `orders` | `bigint` | not null | `shop.oms.pg.v_open_orders.order_id` | — |
| `gross_minor` | `bigint` | null | `shop.oms.pg.v_open_orders.total_minor` | Two hops from orders.total_minor, which is the column a discrepancy is chased back to. |

```sql
CREATE MATERIALIZED VIEW mv_orders_daily AS
SELECT date_trunc('day', placed_at) AS day,
       count(*) AS orders, sum(total_minor) AS gross_minor
  FROM v_open_orders
 GROUP BY 1;
```

Source: `shop/oms/db/migrations/0009_orders_daily.sql`
