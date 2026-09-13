# Invoice partial update

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.billing-invoice-partial-update`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `http` · PATCH /v1/invoices/{id}/
- **Root confidence:** high
- **Source:** [`examples/shop/billing/invoices/views.py`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/views.py)

Invoices over HTTP. Every action here runs one function of services.py. Source-backed cross-protocol continuations are included.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `shop.billing` | service | [shop](../shop/README.md) | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.billing
    p0->>p1: invoice_partial_update
    p1-->>p0: HTTP response
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.billing** — invoice_partial_update
   status: declared · [`examples/shop/billing/invoices/views.py:10`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/billing/invoices/views.py#L10)
<a id="step-response-s1"></a>
2. **shop.billing** → **client** — HTTP response
   status: declared · Synthesized from the proven synchronous HTTP handler return.
