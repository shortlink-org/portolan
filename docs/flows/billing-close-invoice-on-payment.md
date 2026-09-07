# Close invoice on payment

*Generated from the portolan catalog · commit `12 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.billing-close-invoice-on-payment`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/billing/invoices/handlers.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/handlers.py)

Closes the invoice for an order once the ledger says the money arrived.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `bus` | broker | — |
| `shop.billing` | service | [shop](../shop/README.md) |
| `billing-pg` | store | [shop](../shop/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as bus
    participant p1 as shop.billing
    participant p2 as billing-pg
    p0-)p1: PaymentCaptured
    p1->>p2: Invoice.objects.filter
    p1->>p2: Invoice.save
    p1-)p0: InvoicePaid
```

## Steps

<a id="step-s1"></a>
1. **bus** → **shop.billing** — PaymentCaptured
   [`payments.ledger.payment.PaymentCaptured`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentcaptured) · status: declared · [`examples/shop/billing/invoices/handlers.py:10`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/handlers.py#L10)
<a id="step-s2"></a>
2. **shop.billing** → **billing-pg** — Invoice.objects.filter
   status: declared · [`examples/shop/billing/invoices/services.py:57`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L57)
<a id="step-s3"></a>
3. **shop.billing** → **billing-pg** — Invoice.save
   status: declared · [`examples/shop/billing/invoices/services.py:61`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L61)
<a id="step-s4"></a>
4. **shop.billing** → **bus** — InvoicePaid
   [`shop.billing.invoice.InvoicePaid`](../shop/billing/aggregates/invoice.md#event-shop-billing-invoice-invoicepaid) · status: declared · [`examples/shop/billing/invoices/services.py:62`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/services.py#L62) · on shop.billing.invoice
