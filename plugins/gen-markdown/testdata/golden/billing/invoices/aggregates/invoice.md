# Invoice

*Generated from the portolan catalog · commit `abc1234` · at 2026-01-02T03:04:05Z. Do not edit by hand.*

- **Id:** `billing.invoices.invoice`
- **Service:** [Invoices](../README.md)
- **Root:** `Invoice`

One invoice, one customer, one currency.

## Entities

### Invoice — aggregate root

The invoice itself.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Invoice id. |
| `total` | [`Money`](../../../types.md#money) | What is owed. |

## Value objects

### Money

An amount in one currency.

Shared type [`Money`](../../../types.md#money).

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit. |
| `currency` | `string` | ISO 4217, upper case. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `RaiseInvoice` | command | Raises one. |
| `GetInvoice` | query | — |

## Events

### InvoiceRaised

`billing.invoices.invoice.InvoiceRaised`

| Consumer | Status | Note |
| --- | --- | --- |
| `billing.ledger` | declared | Not observed. |

#### v1

The original.

Source: `api/events/v1/invoice_raised.proto`

| Field | Type | Doc |
| --- | --- | --- |
| `invoiceId` | `string` | Which invoice. |

#### v2 — current

Adds the total.

Source: `api/events/v2/invoice_raised.proto`

| Field | Type | Doc |
| --- | --- | --- |
| `invoiceId` | `string` | Which invoice. |
| `total` | [`Money`](../../../types.md#money) | What is owed. |
