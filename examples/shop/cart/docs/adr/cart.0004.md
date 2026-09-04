# Checkout confirms the session with `auth` and the total with `pricing`

- Status: accepted
- Date: 2026-09-04
- Scope: service `shop.cart`

## Context and Problem Statement

Checkout is the moment a basket becomes something money will move for. Two
questions have to be answered before it does: is this still the signed-in
customer, and what is the total. Neither answer is the cart's to give.

## Decision Outcome

At checkout, and only there, the cart calls out, in this order: `auth`,
`GET /v1/sessions/current`, to confirm the bearer token is a live session;
then `pricing`, `shop.v1.Pricing/GetQuote`, for the total over the lines,
promotions and tax included. Only then is the basket frozen and
`BasketCheckedOut` written, in the same transaction, carrying the lines, the
total and the quote id.

Every other operation stays local. Adding to a basket costing a call to
`auth` would make the cart the estate's hottest client of it; the session
matters when the basket is about to become an order, not before.

Without `AUTH_URL` or `PRICING_ADDR` in the environment the port is filled
with a permissive stand-in - every session live, the quote equal to the sum
of the lines - so the service runs on a laptop with only Postgres. A stand-in
is assembly's choice and the use case cannot tell.

### Consequences

- Good: a session that ended between page load and click is refused here,
  by the service that knows, rather than discovered downstream.
- Good: the total on `BasketCheckedOut` is `pricing`'s, so whoever places the
  order does not price it again.
- Bad: checkout has two remote calls on its path and fails when either peer is
  down; that is the honest answer, and the stand-ins are for laptops only.
