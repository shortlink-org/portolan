# Payments

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `payments`
- **Classification:** supporting

Money, and the record of every movement of it. Nothing here decides whether to charge - it is asked, and it writes down what happened either way.

## Services

| Service | Path | Aggregates |
| --- | --- | --- |
| [Ledger](ledger/README.md) | `examples/payments/ledger` | Payment, Refund |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [payments.0004](../adr/payments.0004.md) | Journal entries are idempotent by (order_id, attempt) | proposed | 2026-02-09 |
