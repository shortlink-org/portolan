# Invoice destroy

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.billing-invoice-destroy`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `http` · DELETE /v1/invoices/{id}/
- **Root confidence:** high
- **Source:** [`examples/shop/billing/invoices/views.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/views.py)

Ends an invoice nobody is going to pay. Source-backed cross-protocol continuations are included.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `shop.billing` | service | [shop](../shop/README.md) | — |
| `billing-pg` | store | [shop](../shop/README.md) | [shop.billing.pg](../shop/billing/stores/pg.md) |
| `bus` | broker | — | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.billing
    participant p2 as billing-pg
    participant p3 as bus
    p0->>p1: invoice_destroy
    p1->>p2: Invoice.objects.get
    p1->>p2: Invoice.save
    p1-)p3: InvoiceVoided
    p1-->>p0: HTTP response
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.billing** — invoice_destroy
   status: declared · [`examples/shop/billing/invoices/views.py:34`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/views.py#L34)
<a id="step-s2"></a>
2. **shop.billing** → **billing-pg** — Invoice.objects.get
   status: declared · [`examples/shop/billing/invoices/services.py:68`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L68)
<a id="step-s3"></a>
3. **shop.billing** → **billing-pg** — Invoice.save
   status: declared · [`examples/shop/billing/invoices/services.py:70`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L70)
<a id="step-s4"></a>
4. **shop.billing** → **bus** — InvoiceVoided
   [`shop.billing.invoice.InvoiceVoided`](../shop/billing/aggregates/invoice.md#event-shop-billing-invoice-invoicevoided) · status: declared · [`examples/shop/billing/invoices/services.py:71`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L71) · on shop.billing.invoice
<a id="step-response-s1"></a>
5. **shop.billing** → **client** — HTTP response
   status: declared · Synthesized from the proven synchronous HTTP handler return.
