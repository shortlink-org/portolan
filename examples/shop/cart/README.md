# Shopping Cart

Service `cart` — bounded context **shop**. TypeScript on Node.js.

Owns the basket: the one mutable thing between a customer arriving and an
order existing. A basket belongs to a visitor's token or to a signed-in
customer, changes as items go in and out, and stops changing the moment it is
checked out — from then on the order is somebody else's aggregate and the
basket is a record of what was bought.

## What it does

- Creates a basket for a visitor and lets items go in and out of it.
- Merges a visitor's basket into a customer's after login.
- Checks out: confirms the session with `auth`, takes a quote from `pricing`,
  freezes the basket and says so with `BasketCheckedOut`.
- Abandons baskets nobody has touched for a day, and says so.

## What it does not do

Does not place the order, charge anything or reserve stock: `BasketCheckedOut`
is where its job ends. Does not hold a catalogue - a SKU is a string it was
given, with the price it was given. Does not know who a customer is beyond an
opaque id `auth` vouched for.

## Decisions

- [cart.0001](docs/adr/cart.0001.md) — TypeScript on Node.js, and the stack around it
- [cart.0002](docs/adr/cart.0002.md) — A basket freezes its currency at the first item
- [cart.0003](docs/adr/cart.0003.md) — Line prices are captured when added, never recomputed
- [cart.0004](docs/adr/cart.0004.md) — Checkout confirms the session with `auth` and the total with `pricing`
- [cart.0005](docs/adr/cart.0005.md) — A merge moves every line or none
- [cart.0006](docs/adr/cart.0006.md) — Abandonment is a sweep inside the service, and it publishes
- [cart.0007](docs/adr/cart.0007.md) — An anonymous basket is owned by whoever holds its token

## Running it

```bash
docker compose up -d
npm start
```

`AUTH_URL` and `PRICING_ADDR` point checkout at running peers; without them
every session is live and the quote is the sum of the lines. `TRACER_URI`
switches tracing on. `npm test` runs everything; without Docker the tests that
need Postgres are skipped.
