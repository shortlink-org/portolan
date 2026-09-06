# Remind Unpaid Invoice task

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.billing-celery-remind-unpaid-invoice`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/billing/invoices/services.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py)

Celery task `invoices.tasks.remind_unpaid_invoice` is enqueued on `billing` and worked by `remind_unpaid_invoice`.

## Participants

| Participant | Kind | Context | Label |
| --- | --- | --- | --- |
| `shop.billing` | service | [shop](../shop/README.md) | — |
| `celery-billing` | broker | — | Celery · billing |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as shop.billing
    participant p1 as Celery · billing
    p0->>p1: enqueue remind_unpaid_invoice
    p1->>p0: remind_unpaid_invoice
```

## Steps

<a id="step-enqueue"></a>
1. **shop.billing** → **celery-billing** — enqueue remind_unpaid_invoice
   status: declared · [`examples/shop/billing/invoices/services.py:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L50) · Enqueued after the transaction commits, for later, with a countdown or an eta. Nudges the customer about an invoice that has stayed unpaid.
<a id="step-work"></a>
2. **celery-billing** → **shop.billing** — remind_unpaid_invoice
   status: declared · [`examples/shop/billing/invoices/tasks.py:30`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/tasks.py#L30) · Celery hands `invoices.tasks.remind_unpaid_invoice` to the worker consuming `billing`, the default queue.
