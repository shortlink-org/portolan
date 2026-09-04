# Payments

*Generated from the portolan catalog · commit `4 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `payments`
- **Classification:** core

A double-entry ledger and the PSP integrations that feed it. Nothing here knows what an order is for.

## Services

| Service | Path | Aggregates |
| --- | --- | --- |
| [Ledger](ledger/README.md) | `services/ledger` | Payment, Refund |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [payments.0004](../adr/payments.0004.md) | Journal entries are idempotent by (order_id, attempt) | proposed | 2026-02-09 |
