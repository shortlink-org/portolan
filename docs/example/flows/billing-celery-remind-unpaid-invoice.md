# Remind Unpaid Invoice task

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.billing-celery-remind-unpaid-invoice`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `job` · Celery · billing
- **Root confidence:** high
- **Source:** [`examples/shop/billing/invoices/services.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py)

Celery task `invoices.tasks.remind_unpaid_invoice` is enqueued on `billing` and worked by `remind_unpaid_invoice`. Source-backed cross-protocol continuations are included.

## Participants

| Participant | Kind | Context | Entity | Label |
| --- | --- | --- | --- | --- |
| `shop.billing` | service | [shop](../shop/README.md) | — | — |
| `celery-billing` | broker | — | — | Celery · billing |
| `billing-pg` | store | [shop](../shop/README.md) | [shop.billing.pg](../shop/billing/stores/pg.md) | — |

## Composition

| Fragment | After step | Seam | Target | Evidence | Source |
| --- | --- | --- | --- | --- | --- |
| [billing-celery-body-invoices-tasks-remind-unpaid-invoice](billing-celery-body-invoices-tasks-remind-unpaid-invoice.md) | [work](billing-celery-remind-unpaid-invoice.md#step-work) | `entrypoint` | `python:invoices.tasks:remind_unpaid_invoice` | high · exact source entrypoint | [`examples/shop/billing/invoices/tasks.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/tasks.py) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as shop.billing
    participant p1 as Celery · billing
    participant p2 as billing-pg
    p0->>p1: enqueue remind_unpaid_invoice
    p1->>p0: remind_unpaid_invoice
    p0->>p2: Invoice.objects.filter
```

## Steps

<a id="step-enqueue"></a>
1. **shop.billing** → **celery-billing** — enqueue remind_unpaid_invoice
   status: declared · [`examples/shop/billing/invoices/services.py:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L50) · Enqueued after the transaction commits, for later, with a countdown or an eta. Nudges the customer about an invoice that has stayed unpaid. · handoff: send · job · celery · billing · invoices.tasks.remind_unpaid_invoice
<a id="step-work"></a>
2. **celery-billing** → **shop.billing** — remind_unpaid_invoice
   status: declared · [`examples/shop/billing/invoices/tasks.py:30`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/tasks.py#L30) · Celery hands `invoices.tasks.remind_unpaid_invoice` to the worker consuming `billing`, the default queue. · continues at `python:invoices.tasks:remind_unpaid_invoice` · handoff: receive · job · celery · billing · invoices.tasks.remind_unpaid_invoice
<a id="step-continuation-billing-celery-body-invoices-tasks-remind-unpaid-invoice-work-s1"></a>
3. **shop.billing** → **billing-pg** — Invoice.objects.filter
   status: declared · [`examples/shop/billing/invoices/tasks.py:32`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/tasks.py#L32)
