# Messaging

*Generated from the portolan catalog. Do not edit by hand.*

Every row is one service's declaration. Matching channel and message names are shown together for comparison, but are not silently merged into global entities.

## Channels

| Channel | Protocol | Service | Used to | Messages | Issue | Source | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `billing_invoice` | unknown | [billing.invoices](billing/invoices/README.md) | send | 1 message | clear | `api/asyncapi.yaml` | Changes to an invoice. |

## Messages

| Message | Direction | Channel | Protocol | Service | Domain event | Issue | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `billing.InvoiceRaised` | send | `billing_invoice` | unknown | [billing.invoices](billing/invoices/README.md) | [`billing.InvoiceRaised`](billing/invoices/aggregates/invoice.md#event-billing-invoices-invoice-invoiceraised) | clear | `api/asyncapi.yaml` |
