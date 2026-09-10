# Invoices

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `billing.invoices`
- **Context:** [Billing](../README.md)
- **Repo:** [`github.com/example/billing`](https://github.com/example/billing)
- **Path:** `examples/billing/`

Raises invoices and chases them. The vocabulary is [GLOSSARY.md](../glossary.md).

The currency rule is recorded in [billing.0001](../../adr/billing.0001.md).

## Not here

No dunning.

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Invoice](aggregates/invoice.md) | `Invoice` | 1 command | 1 query | 1 event |

## Provides

### billing.v1.Invoices

- **Source:** `api/invoices.proto`
- **Module:** [buf.build/example/billing](../../modules/example-billing.md)

| Method | Route | Request | Response | Mode | Doc |
| --- | --- | --- | --- | --- | --- |
| `Get` | `GET /v1/invoices/{id}` | — | `Invoice` | deprecated | — |
| `Raise` | — | `RaiseRequest` | `Invoice` | server | Raises and follows one invoice. |

<a id="message-raiserequest"></a>
<details><summary>RaiseRequest</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `total` | [`Money`](../../types.md#type-money) | What is owed. |

</details>

<a id="enum-kind"></a>
<details><summary>Kind (enum)</summary>

What the invoice is for.

| Value | Number | Doc |
| --- | --- | --- |
| `KIND_UNSPECIFIED` | 0 | — |
| `KIND_ORDER` | 1 | An order's goods. |

</details>

## Consumes

| Call | Peer | Status | Source | Via | Note |
| --- | --- | --- | --- | --- | --- |
| `psp.v1.Charges/Create` | [psp-gateway](../../externals/psp-gateway.md) | declared | `internal/psp/client.go:20` | [`flow.raise-invoice#s3`](../../flows/raise-invoice.md#step-s3) | The gateway is outside the estate; the copy beside the client says what it answers on. |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [`InvoiceRaised`](aggregates/invoice.md#event-billing-invoices-invoice-invoiceraised) | v2 | `billing.ledger (declared)` |

## Channels

### billing_invoice

**Invoice events**

Changes to an invoice.

Source: `api/asyncapi.yaml`

| Direction | Message | Title |
| --- | --- | --- |
| send | [`billing.InvoiceRaised`](aggregates/invoice.md#event-billing-invoices-invoice-invoiceraised) | Invoice raised |

## Schema modules

| Module | Access | Commit | Packages |
| --- | --- | --- | --- |
| [Billing contracts](../../modules/example-billing.md) | publishes | 0123456789012345678901234567890123456789 | billing.v1 |

## Stores

| Store | Kind | Access | Schema |
| --- | --- | --- | --- |
| [Invoices Postgres](stores/pg.md) | postgres | owns | 2 tables |
