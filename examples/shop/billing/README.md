# Billing

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
