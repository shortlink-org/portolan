# Golden estate

*Generated from the portolan catalog · commit `abc1234` · at 2026-01-02T03:04:05Z. Do not edit by hand.*


## Contexts

| Context | Class | Services | Summary |
| --- | --- | --- | --- |
| [Billing](billing/README.md) | core | [Invoices](billing/invoices/README.md) | Money owed and money taken. |

## Outside the estate

| System | Interfaces | Summary |
| --- | --- | --- |
| [PSP gateway](externals/psp-gateway.md) | `psp.v1.Charges` | The card network the invoices are settled through. Nobody here builds it; the copy of its document vendored beside the client is all the catalog may claim. |

## Flows

| Flow | Owner | Summary |
| --- | --- | --- |
| [Raise an invoice](flows/raise-invoice.md) | [billing](billing/README.md) | An invoice is raised, and paid or written off. |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [billing.0001](adr/billing.0001.md) | One currency per invoice | accepted | 2026-01-01 |
