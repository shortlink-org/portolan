# Billing database

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.billing.pg`
- **Kind:** postgres
- **Owner:** [shop.billing](../README.md)
- **Source:** `examples/shop/billing`

## Tables

### invoices

aggregate-root · persists [shop.billing.invoice](../aggregates/invoice.md) · block `shop.billing.invoice.invoice`

| Column | Type | Null | Key | Maps | Doc |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | not null | PK | Invoice.id | — |
| `order_id` | `uuid` | not null | — | Invoice.order_id | The order this invoice is drawn up for. |
| `customer_id` | `uuid` | not null | — | Invoice.customer_id | Opaque, and only ever as good as the session auth vouched for. |
| `number` | `varchar(32)` | null | — | Invoice.number | What the customer quotes. A draft has none. |
| `currency` | `varchar(3)` | not null | — | Invoice.currency | ISO 4217, frozen when the first line is drawn up. |
| `total_minor` | `bigint` | not null | — | Invoice.total_minor | The sum of the lines, in the minor unit of the currency. |
| `tax_rate` | `numeric(5,4)` | not null | — | Invoice.tax_rate | The rate the total was taxed at. |
| `status` | `varchar(16)` | not null | — | Invoice.status | — |
| `drawn_up_at` | `timestamptz` | not null | — | Invoice.drawn_up_at | — |
| `issued_at` | `timestamptz` | null | — | Invoice.issued_at | — |
| `settled_at` | `timestamptz` | null | — | Invoice.settled_at | When it was paid or voided; null while it is neither. |

| Index | Columns | Kind |
| --- | --- | --- |
| `invoices_order_id` | order_id | index |
| `invoices_number_key` | number | unique |
| `invoices_by_customer` | customer_id, status | index |

### invoice_lines

child · persists [shop.billing.invoice](../aggregates/invoice.md) · block `shop.billing.invoice.invoice-line`

| Column | Type | Null | Key | Maps | Doc |
| --- | --- | --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK | — | — |
| `invoice_id` | `uuid` | not null | → [`shop.billing.pg.invoices`](pg.md#invoices).id (cascade) | Invoice.id | — |
| `sku` | `varchar(64)` | not null | — | InvoiceLine.sku | — |
| `quantity` | `integer` | not null | — | InvoiceLine.quantity | — |
| `unit_price` | `bigint` | not null | — | InvoiceLine.unit_price_minor | Captured when the line is drawn up, never recomputed. |

| Index | Columns | Kind |
| --- | --- | --- |
| `invoice_lines_invoice_id_sku_key` | invoice_id, sku | unique |
