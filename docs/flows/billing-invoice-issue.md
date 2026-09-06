# Invoice issue

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.billing-invoice-issue`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/billing/invoices/views.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/views.py)

Confirms the session, freezes the invoice and asks the customer to pay.

## Participants

| Participant | Kind | Context | Label |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `shop.billing` | service | [shop](../shop/README.md) | — |
| `auth.auth` | service | [auth](../auth/README.md) | — |
| `billing-pg` | store | [shop](../shop/README.md) | — |
| `celery-billing-mail` | broker | — | Celery · billing.mail |
| `celery-billing` | broker | — | Celery · billing |
| `bus` | broker | — | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.billing
    participant p2 as auth.auth
    participant p3 as billing-pg
    participant p4 as Celery · billing.mail
    participant p5 as Celery · billing
    participant p6 as bus
    p0->>p1: invoice_issue → InvoiceId
    p1->>p2: validateSession → SessionInfo
    p1->>p3: Invoice.objects.get
    p1->>p3: Invoice.save
    p1->>p4: enqueue send_invoice_email
    p1->>p5: enqueue remind_unpaid_invoice
    p1-)p6: InvoiceIssued
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.billing** — invoice_issue → InvoiceId
   status: declared · [`examples/shop/billing/invoices/views.py:29`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/views.py#L29)
<a id="step-s2"></a>
2. **shop.billing** → **auth.auth** — validateSession → SessionInfo
   `auth.v1.Sessions/validateSession` · status: declared · [`examples/shop/billing/invoices/services.py:40`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L40)
<a id="step-s3"></a>
3. **shop.billing** → **billing-pg** — Invoice.objects.get
   status: declared · [`examples/shop/billing/invoices/services.py:41`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L41)
<a id="step-s4"></a>
4. **shop.billing** → **billing-pg** — Invoice.save
   status: declared · [`examples/shop/billing/invoices/services.py:46`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L46) · in one transaction.
<a id="step-s5"></a>
5. **shop.billing** → **celery-billing-mail** — enqueue send_invoice_email
   status: declared · [`examples/shop/billing/invoices/services.py:49`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L49) · in one transaction, after the transaction commits.
<a id="step-s6"></a>
6. **shop.billing** → **celery-billing** — enqueue remind_unpaid_invoice
   status: declared · [`examples/shop/billing/invoices/services.py:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L50) · in one transaction, after the transaction commits.
<a id="step-s7"></a>
7. **shop.billing** → **bus** — InvoiceIssued
   [`shop.billing.invoice.InvoiceIssued`](../shop/billing/aggregates/invoice.md#event-shop-billing-invoice-invoiceissued) · status: declared · [`examples/shop/billing/invoices/services.py:51`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L51) · on shop.billing.invoice
