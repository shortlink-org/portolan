# Shopping Cart

Service `shop.cart` — bounded context **shop**.

Owns the basket and turns it into an order. A cart is the only mutable thing in
checkout; once it is submitted it stops changing and an order exists in its
place.

## What it does

- Holds line items for a session or a subject, merging the anonymous cart into
  the signed-in one at login.
- Prices the basket: quantities, promotions, the running total.
- Freezes the presentment currency at the first line added — a basket that would
  mix two currencies is refused rather than converted.
- Validates at checkout (stock, address, session still live) and submits the
  order.
- Expires idle carts and releases whatever they were holding.

## What it does not do

Does not charge anything and does not ship anything. It calls `auth` to confirm
the session, then hands off to `shop.billing` for payment and `shop.delivery`
for fulfilment.

## Publishes

`CartCreated`, `CartItemAdded`, `CartItemRemoved`, `CartAbandoned`,
`OrderPlaced`.
