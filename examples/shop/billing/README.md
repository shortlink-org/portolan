# Billing & Payments

Service `shop.billing` — bounded context **shop**.

Owns money. Every charge, refund and invoice against an order passes through
here, and the ledger it keeps is the record the business is audited on.

## What it does

- Authorises a payment at checkout and captures it once the order is confirmed —
  two steps, because an order that never ships must not be charged.
- Talks to the payment gateway and reconciles its webhooks against the ledger,
  which is the one place the two systems can disagree.
- Issues refunds, in full or per line, against a captured payment.
- Produces invoices and credit notes, and holds the tax breakdown behind them.
- Keeps double-entry ledger postings; nothing here is ever updated in place.

## What it does not do

Does not decide *whether* to charge — that is the order's business — and does
not store card data. The gateway holds the instrument; billing holds a token
for it.

## Publishes

`PaymentAuthorized`, `PaymentCaptured`, `PaymentFailed`, `RefundIssued`,
`InvoiceCreated`.
