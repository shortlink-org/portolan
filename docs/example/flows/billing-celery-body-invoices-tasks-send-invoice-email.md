# Send invoice email work

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.billing-celery-body-invoices-tasks-send-invoice-email`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `job` · Celery · invoices.tasks.send_invoice_email
- **Root confidence:** high
- **Source:** [`examples/shop/billing/invoices/tasks.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/tasks.py)

Emails the customer the invoice they were asked to pay. Observable work performed by the Celery task.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `shop.billing` | service | [shop](../shop/README.md) | — |
| `billing-pg` | store | [shop](../shop/README.md) | [shop.billing.pg](../shop/billing/stores/pg.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as shop.billing
    participant p1 as billing-pg
    p0->>p1: Invoice.objects.get
```

## Steps

<a id="step-s1"></a>
1. **shop.billing** → **billing-pg** — Invoice.objects.get
   status: declared · [`examples/shop/billing/invoices/tasks.py:20`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/tasks.py#L20)
