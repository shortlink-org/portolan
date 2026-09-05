# Ledger database

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `payments.ledger.pg`
- **Kind:** postgres
- **Owner:** [payments.ledger](../README.md)
- **Source:** `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/repository`

## Tables

### payments

aggregate-root · persists [payments.ledger.payment](../aggregates/payment.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Payment.id |
| `order_id` | `text` | not null | — | Payment.orderId |
| `attempt` | `integer` | not null | — | Payment.attempt |
| `amount_minor` | `bigint` | not null | — | Payment.amountMinor |
| `currency` | `char(3)` | not null | — | Payment.currency |
| `status` | `text` | not null | — | Payment.status |
| `auth_code` | `text` | null | — | Payment.authCode |
| `created_at` | `timestamptz` | not null | — | Payment.createdAt |

| Index | Columns | Kind |
| --- | --- | --- |
| `payments_order_attempt_key` | order_id, attempt | unique |
| `payments_status_idx` | status | index |

### postings

child · persists [payments.ledger.payment](../aggregates/payment.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK | Posting.id |
| `payment_id` | `text` | not null | → [`payments.ledger.pg.payments`](pg.md#payments).id (restrict) | Posting.paymentId |
| `account` | `text` | not null | — | Posting.account |
| `amount_minor` | `bigint` | not null | — | Posting.amountMinor |
| `currency` | `char(3)` | not null | — | Posting.currency |
| `written_at` | `timestamptz` | not null | — | Posting.writtenAt |

| Index | Columns | Kind |
| --- | --- | --- |
| `postings_by_payment` | payment_id | index |

### refunds

aggregate-root · persists [payments.ledger.refund](../aggregates/refund.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Refund.id |
| `payment_id` | `text` | not null | → [`payments.ledger.pg.payments`](pg.md#payments).id (restrict) | Refund.paymentId |
| `order_id` | `text` | not null | — | Refund.orderId |
| `amount_minor` | `bigint` | not null | — | Refund.amountMinor |
| `currency` | `char(3)` | not null | — | Refund.currency |
| `reason` | `text` | not null | — | Refund.reason |
| `status` | `text` | not null | — | Refund.status |
| `settled_at` | `timestamptz` | null | — | Refund.settledAt |

| Index | Columns | Kind |
| --- | --- | --- |
| `refunds_by_payment` | payment_id | index |

## Views

### v_payment_state

computed on read · reads [`payments.ledger.pg.payments`](pg.md#payments), [`payments.ledger.pg.refunds`](pg.md#refunds)

| Column | Type | Null | Maps | From |
| --- | --- | --- | --- | --- |
| `payment_id` | `text` | not null | Payment.id | `payments.ledger.pg.payments.id` |
| `order_id` | `text` | not null | Payment.orderId | `payments.ledger.pg.payments.order_id` |
| `status` | `text` | not null | Payment.status | `payments.ledger.pg.payments.status` |
| `amount_minor` | `bigint` | not null | Payment.amountMinor | `payments.ledger.pg.payments.amount_minor` |
| `refunded_minor` | `bigint` | not null | Refund.amountMinor | `payments.ledger.pg.refunds.amount_minor` |

```sql
CREATE VIEW v_payment_state AS
SELECT p.id           AS payment_id,
       p.order_id     AS order_id,
       p.status       AS status,
       p.amount_minor AS amount_minor,
       coalesce(sum(r.amount_minor), 0) AS refunded_minor
  FROM payments p
  LEFT JOIN refunds r ON r.payment_id = p.id AND r.status = 'ISSUED'
 GROUP BY p.id;
```

Source: `src/main/java/org/portolan/payments/ledger/infrastructure/repository/refund/migrations/0002_payment_state.sql`
