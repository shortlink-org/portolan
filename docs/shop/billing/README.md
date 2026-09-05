# Billing

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `shop.billing`
- **Context:** [Shop](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/shop/billing`

Service `billing` — bounded context **shop**. Python on Django.

Owns the invoice: what a customer is asked to pay for one order, and what
happens to it between being drawn up and being closed. It does not move money.
`payments.ledger` does that; billing records what was owed, what it was for,
and when it was settled.

## What it does

- Draws up a draft invoice, with its lines, against an order.
- Issues it: confirms the session with `auth`, freezes the lines, gives the
  invoice the number the customer will quote, and says `InvoiceIssued`.
- Closes it when the ledger says the money arrived — it listens for
  `PaymentCaptured` and answers with `InvoicePaid`.
- Voids an invoice nobody is going to pay.

## What it does not do

Does not authorise, capture or refund anything: money is `payments.ledger`'s,
and billing only hears about it. Does not price anything — a line arrives with
the amount it was sold at. Does not hold card data, or know who a customer is
beyond an opaque id `auth` vouched for.

## Publishes

`InvoiceIssued`, `InvoicePaid`, `InvoiceVoided`, on `shop.billing.invoice`.

## How the catalog reads it

Nothing here is annotated for the catalog: `extract-django` reads the
applications, and the applications are the claim — `invoices/models.py` is the
aggregate and the schema, `events.py` is what leaves, `services.py` is what can
be asked for, the DRF view and `urls.py` are the way in, and `handlers.py` is
what runs when somebody else's event arrives. The rules are in
[plugins/extract-django/README.md](../../../plugins/extract-django/README.md).

```bash
docker compose up -d db
python manage.py migrate && python manage.py runserver
```

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Invoice](aggregates/invoice.md) | `Invoice` | 4 commands | 1 query | 3 events |

## Provides

**`billing.v1.Invoices`** — `examples/shop/billing/invoices/schema/openapi.yaml`

- `invoice_create`
- `invoice_retrieve`
- `invoice_destroy`
- `invoice_issue`

<details><summary>DrawUpRequest</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `orderId` | `string (uuid)` | — |
| `customerId` | `string (uuid)` | — |
| `currency` | `string` | ISO 4217. |
| `taxRate` | `string` | A decimal, as a string, so nothing rounds on the way in. |
| `lines` | `[]Line` | — |

</details>

<details><summary>InvoiceId</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `invoiceId` | `string (uuid)` | Optional. |
| `number` | `string` | Optional. |

</details>

<details><summary>Invoice</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `invoiceId` | `string (uuid)` | Optional. |
| `orderId` | `string (uuid)` | Optional. |
| `number` | `string` | Optional. |
| `currency` | `string` | Optional. |
| `totalMinor` | `integer (int64)` | Optional. |
| `status` | `string enum(draft \| issued \| paid \| void)` | Optional. |
| `lines` | `[]Line` | Optional. |

</details>

<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `integer` |
| `unitPriceMinor` | `integer (int64)` |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `auth.v1.Sessions/validateSession` | [auth.auth](../../auth/auth/README.md) | declared | `examples/shop/billing/invoices/clients/auth/openapi.yaml` |

## Publishes

| Event | Latest |
| --- | --- |
| [InvoiceIssued](aggregates/invoice.md) | v1 |
| [InvoicePaid](aggregates/invoice.md) | v1 |
| [InvoiceVoided](aggregates/invoice.md) | v1 |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Billing database](stores/pg.md) | postgres | owns | 2 tables |
