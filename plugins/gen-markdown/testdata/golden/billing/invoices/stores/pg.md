# Invoices Postgres

*Generated from the portolan catalog · commit `abc1234` · at 2026-01-02T03:04:05Z. Do not edit by hand.*

- **Id:** `billing.invoices.pg`
- **Kind:** postgres
- **Owner:** [billing.invoices](../README.md)
- **Source:** `migrations/`

## Tables

### invoices

aggregate-root · persists [billing.invoices.invoice](../aggregates/invoice.md)

One row per invoice.

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | not null | PK | Invoice.ID |
| `total_minor` | `bigint` | not null | — | Invoice.Total.AmountMinor |

| Index | Columns | Kind |
| --- | --- | --- |
| `invoices_pkey` | id | unique |

### invoice_lines

child

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `uuid` | not null | PK |
| `invoice_id` | `uuid` | not null | → [`billing.invoices.pg.invoices`](pg.md#invoices).id (cascade) |

## Views

### invoice_totals

**materialized** — rows are stored, and can be stale · reads [`billing.invoices.pg.invoices`](pg.md#invoices)

Totals, refreshed nightly.

| Column | Type | Null | From |
| --- | --- | --- | --- |
| `id` | `uuid` | not null | `billing.invoices.pg.invoices.id` |
| `total_minor` | `bigint` | null | `billing.invoices.pg.invoices.total_minor` |

```sql
SELECT id, total_minor FROM invoices
```
