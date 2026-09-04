# Ledger database

*Generated from the portolan catalog · commit `4 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `payments.ledger.pg`
- **Kind:** postgres
- **Owner:** [payments.ledger](../README.md)
- **Source:** `payments/ledger/db/migrations`

## Tables

### journal_entries

aggregate-root · persists [payments.ledger.payment](../aggregates/payment.md)

Append-only. One row per capture attempt, unique on (order_id, attempt) per ADR payments.0004.

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Payment.id |
| `order_id` | `text` | not null | — | Payment.orderId |
| `attempt` | `integer` | not null | — | CaptureAttempt.attempt |
| `amount_minor` | `bigint` | not null | — | Payment.amount |
| `currency` | `char(3)` | not null | — | — |
| `state` | `text` | not null | — | Payment.state |
| `gateway_charge_id` | `text` | null | — | Payment.gateway |
| `requested_at` | `timestamptz` | not null | — | CaptureAttempt.requestedAt |

| Index | Columns | Kind |
| --- | --- | --- |
| `journal_entries_order_attempt_key` | order_id, attempt | unique |
| `journal_entries_state_idx` | state | index |

### refunds

child · persists [payments.ledger.refund](../aggregates/refund.md)

Refunds against a captured payment.

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Refund.id |
| `payment_id` | `text` | not null | → [`payments.ledger.pg.journal_entries`](pg.md#journal_entries).id (restrict) | Refund.paymentId |
| `amount_minor` | `bigint` | not null | — | Refund.amount |
| `reason` | `text` | not null | — | Refund.reason |
| `state` | `text` | not null | — | Refund.state |
| `settled_at` | `timestamptz` | null | — | Settlement.settledAt |

## Views

### v_payment_state

computed on read

Every payment with what has been refunded against it. One row per journal entry.

| Column | Type | Null | Maps | From |
| --- | --- | --- | --- | --- |
| `payment_id` | `text` | not null | Payment.id | `payments.ledger.pg.journal_entries.id` |
| `order_id` | `text` | not null | Payment.orderId | `payments.ledger.pg.journal_entries.order_id` |
| `state` | `text` | not null | Payment.state | `payments.ledger.pg.journal_entries.state` |
| `amount_minor` | `bigint` | not null | Payment.amount | `payments.ledger.pg.journal_entries.amount_minor` |
| `refunded_minor` | `bigint` | not null | — | `payments.ledger.pg.refunds.amount_minor` |

```sql
CREATE VIEW v_payment_state AS
SELECT j.id AS payment_id, j.order_id, j.state,
       j.amount_minor, coalesce(sum(r.amount_minor), 0) AS refunded_minor
  FROM journal_entries j
  LEFT JOIN refunds r ON r.payment_id = j.id
 GROUP BY j.id;
```

Source: `payments/ledger/db/migrations/0011_payment_state.sql`
