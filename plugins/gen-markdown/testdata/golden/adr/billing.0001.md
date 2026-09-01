# billing.0001 — One currency per invoice

*Generated from the portolan catalog · commit `abc1234` · at 2026-01-02T03:04:05Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-01-01
- **Scope:** [billing](../billing/README.md)
- **Source:** `docs/adr/0001.md`

## Decision

An invoice is in one currency.

## Relates to

- **Services:** [billing.invoices](../billing/invoices/README.md)
- **Events:** [billing.invoices.invoice.InvoiceRaised](../billing/invoices/aggregates/invoice.md)
- **Flows:** [flow.raise-invoice](../flows/raise-invoice.md)
