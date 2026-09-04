# Basket

The one mutable thing between a customer arriving and an order existing: a
visitor's or a customer's lines, under one lock. It changes as items go in and
out and stops changing the moment it is checked out; from then on the order is
somebody else's aggregate and the basket is a record of what was bought.

## States

`open` → `checked-out` | `abandoned` | `merged`. Only an open basket changes.

## Invariants

- One currency, set by the first line and never changed (cart.0002).
- A line's price is what it was given when added, never recomputed (cart.0003).
- One to 99 of a SKU per line; at most 50 distinct SKUs.
- A version travels with every write; a write from a stale read is refused.
