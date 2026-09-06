# Billing

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `shop.billing`
- **Context:** [Shop](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`examples/shop/billing/`](https://github.com/shortlink-org/portolan/tree/main/examples/shop/billing)
- **Owners:** `@shortlink-org/shop`

Service `billing` — bounded context **shop**. Python on Django.

Owns the invoice: what a customer is asked to pay for one order, and what
happens to it between being drawn up and being closed. It does not move money.
`payments.ledger` does that; billing records what was owed, what it was for,
and when it was settled.

## What it does

- Draws up a draft invoice, with its lines, against an order.
- Issues it: confirms the session with `auth`, freezes the lines, gives the
  invoice the number the customer will quote, and says `InvoiceIssued`.
- Mails the invoice to the customer, and reminds them a few days later if it
  is still unpaid — both off the request, as Celery tasks enqueued once the
  row is committed.
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
`extract-celery` reads the rest: `invoices/tasks.py` is what runs later, the
`.delay()` and `.apply_async()` in `services.py` are where it is set off, and
the `CELERY_` lines in `config/settings.py` say which queue each task lands
on. The rules are in
[plugins/extract-celery/README.md](../../../plugins/extract-celery/README.md).

```bash
docker compose up -d db redis
python manage.py migrate && python manage.py runserver
celery -A config worker -Q billing,billing.mail
```

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Invoice](aggregates/invoice.md) | `Invoice` | 4 commands | 1 query | 3 events |

## Provides

### billing.v1.Invoices

- **Source:** [`examples/shop/billing/invoices/schema/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/schema/openapi.yaml)

| Method | Route | Request | Response |
| --- | --- | --- | --- |
| `invoice_create` | `POST /v1/invoices` | `DrawUpRequest` | `InvoiceId` |
| `invoice_destroy` | `DELETE /v1/invoices/{id}` | — | `204` |
| `invoice_issue` | `POST /v1/invoices/{id}/issue` | — | `InvoiceId` |
| `invoice_retrieve` | `GET /v1/invoices/{id}` | — | `Invoice` |

<a id="message-drawuprequest"></a>
<details><summary>DrawUpRequest</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `orderId` | `string (uuid)` | — |
| `customerId` | `string (uuid)` | — |
| `currency` | `string` | ISO 4217. |
| `taxRate` | `string` | A decimal, as a string, so nothing rounds on the way in. |
| `lines` | `[]Line` | — |

</details>

<a id="message-invoice"></a>
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

<a id="message-invoiceid"></a>
<details><summary>InvoiceId</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `invoiceId` | `string (uuid)` | Optional. |
| `number` | `string` | Optional. |

</details>

<a id="message-line"></a>
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
| `auth.v1.Sessions/validateSession` | [auth.auth](../../auth/auth/README.md) | declared | [`examples/shop/billing/invoices/clients/auth/openapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/clients/auth/openapi.yaml) |

## Publishes

| Event | Latest |
| --- | --- |
| [`InvoiceIssued`](aggregates/invoice.md#event-shop-billing-invoice-invoiceissued) | v1 |
| [`InvoicePaid`](aggregates/invoice.md#event-shop-billing-invoice-invoicepaid) | v1 |
| [`InvoiceVoided`](aggregates/invoice.md#event-shop-billing-invoice-invoicevoided) | v1 |

## Channels

### billing

**Celery · billing**

`work queue`

Tasks enqueued and worked through Celery over redis.

Source: [`examples/shop/billing/invoices/services.py:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L50)

| Direction | Message | Title | Doc |
| --- | --- | --- | --- |
| send | `invoices.tasks.remind_unpaid_invoice` | remind_unpaid_invoice | Nudges the customer about an invoice that has stayed unpaid. |
| receive | `invoices.tasks.remind_unpaid_invoice` | remind_unpaid_invoice | Worked by `remind_unpaid_invoice`, the default queue. Nudges the customer about an invoice that has stayed unpaid. |

### billing.mail

**Celery · billing.mail**

`work queue`

Tasks enqueued and worked through Celery over redis.

Source: [`examples/shop/billing/invoices/services.py:49`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L49)

| Direction | Message | Title | Doc |
| --- | --- | --- | --- |
| send | `invoices.tasks.send_invoice_email` | send_invoice_email | Emails the customer the invoice they were asked to pay. |
| receive | `invoices.tasks.send_invoice_email` | send_invoice_email | Worked by `send_invoice_email`, routed by task_routes. Emails the customer the invoice they were asked to pay. |

### shop.billing.invoice

**Invoice**

The subject every invoice event leaves on. The event's name is on the message metadata, so a subscriber dispatches without parsing the payload.

Source: [`examples/shop/billing/invoices/bus/asyncapi.yaml`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/bus/asyncapi.yaml)

| Direction | Message | Title | Doc |
| --- | --- | --- | --- |
| send | [`billing.InvoiceIssued`](aggregates/invoice.md#event-shop-billing-invoice-invoiceissued) | Invoice issued | The invoice is final and the customer has been asked to pay it. |
| send | [`billing.InvoicePaid`](aggregates/invoice.md#event-shop-billing-invoice-invoicepaid) | Invoice paid | The money arrived and the invoice is closed. |
| send | [`billing.InvoiceVoided`](aggregates/invoice.md#event-shop-billing-invoice-invoicevoided) | Invoice voided | The invoice was ended without payment. |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Billing database](stores/pg.md) | postgres | owns | 2 tables |
