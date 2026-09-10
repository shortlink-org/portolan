# Raise an invoice

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.raise-invoice`
- **Owner:** [billing](../billing/README.md)
- **Source:** `test/e2e/raise_test.go`

An invoice is raised, and paid or written off.

## Participants

| Participant | Kind | Context | Label |
| --- | --- | --- | --- |
| `operator` | actor | — | — |
| `billing.invoices` | service | [billing](../billing/README.md) | — |
| `bus` | broker | — | — |
| `psp-gateway` | external | — | psp-gateway (external) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as operator
    participant p1 as billing.invoices
    participant p2 as bus
    participant p3 as psp-gateway (external)
    p0->>p1: Raise → Invoice
    p1-)p2: billing.invoices.invoice.InvoiceRaised
    loop until paid or written off
        alt customer pays
            par settle and notify
                p1->>p3: psp.v1.Charges/Create → Charge
            and
                p1->>p1: markPaid #35;1
            end
        else written off
            p1->>p0: write-off notice
            Note over p0: flow ends here
        end
    end
```

## Steps

<a id="step-s1"></a>
1. **operator** → **billing.invoices** — Raise → Invoice
   `test/e2e/raise_test.go:31`
<a id="step-s2"></a>
2. **billing.invoices** → **bus** — billing.invoices.invoice.InvoiceRaised
   [`billing.invoices.invoice.InvoiceRaised`](../billing/invoices/aggregates/invoice.md#event-billing-invoices-invoice-invoiceraised)

> **Repeats** — until paid or written off
>
>
> > **One of**
> >
> > *customer pays*
> >
> >
> > > **In parallel** — settle and notify
> > >
> > > *Branch 1*
> > >
> > > <a id="step-s3"></a>
> > > 3. **billing.invoices** → **psp-gateway** — psp.v1.Charges/Create → Charge
> > >    `psp.v1.Charges/Create` · status: declared · The gateway is outside this catalog.
> > >
> > > *Branch 2*
> > >
> > > <a id="step-s4"></a>
> > > 4. **billing.invoices** ↺ **billing.invoices** — markPaid #1
> >
> >
> > *written off — *ends the flow**
> >
> > <a id="step-s5"></a>
> > 5. **billing.invoices** → **operator** — write-off notice
> >    status: declared
