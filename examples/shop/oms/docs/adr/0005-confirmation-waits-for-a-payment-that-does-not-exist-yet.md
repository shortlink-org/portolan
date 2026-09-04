# oms.0005 — Confirmation waits for a payment service that does not exist yet

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** shop.oms

## Context and Problem Statement

An order is confirmed when its total is authorised. The service that does
that, `payments`, is not written. Does confirmation wait for it, or is every
order confirmed on placing?

## Decision Outcome

It waits, and the waiting is written down twice. `ConfirmOrder` asks a
`Payments` port for an authorisation; the adapter over `payments.v1` is a
narrowed copy of a contract nobody serves, so the catalog shows the call
unresolved, and a stand-in that grants everything fills the port when no
address is configured. A policy reacts to `payments.PaymentAuthorized`, an
event nothing publishes, and the catalog shows that too. When the ledger
arrives it fills both places and nothing here changes shape.

### Consequences

- Good: the estate's gaps are in the catalog rather than in somebody's head.
- Bad: with the stand-in, an order is confirmed by whoever calls
  `ConfirmOrder` - which nothing does yet, so no order is confirmed at all
  until the ledger exists.
