# Shopping Cart

Service `cart` — bounded context **shop**. TypeScript on Node.js; the rest of
the estate so far is Go, and this service exists partly to prove that the
catalog does not care.

Owns the basket: the one mutable thing between a customer arriving and an
order existing. A basket belongs to a visitor's token or to a signed-in
customer, changes as items go in and out, and stops changing the moment it is
checked out — from then on the order is somebody else's aggregate and the
basket is a record of what was bought.

## What it does

- Creates a basket for a visitor, anonymous, keyed by an opaque token.
- Adds and removes items. The price is captured as the item goes in and is
  never recomputed: what the customer saw is what the basket holds.
- Freezes the currency at the first item. A basket that would mix two
  currencies is refused rather than converted.
- Merges a visitor's basket into a customer's after login, on the storefront's
  say-so.
- Checks out: confirms the session is still live with `auth`, asks `pricing`
  for a quote over the items, freezes the basket and says so with an event.
- Expires baskets nobody has touched for a day, and says so with an event.

## What it does not do

Does not place the order, charge anything or reserve stock. `BasketCheckedOut`
is where the basket's job ends; whoever turns it into an order listens for it.
Does not hold a catalogue: a SKU is a string it was given, with the price it
was given. Does not know who a customer is beyond an opaque id that `auth`
vouched for.

## Domain

One aggregate. Everything a basket is - its items, its currency, its state -
is decided under one lock, because every rule below is a rule about the whole
basket and not about one line of it.

| | Root | Entities | Value objects | Publishes |
|---|---|---|---|---|
| `basket` | `Basket` — id, token, customer, currency, status, touched at, version | `BasketItem` — sku, quantity, unit price | `LineItem`, `Money`, `Currency` | `BasketCreated`, `BasketItemAdded`, `BasketItemRemoved`, `BasketCheckedOut`, `BasketAbandoned` |

The aggregate returns its events rather than buffering them: a method that
changes the basket answers with the fact, and publishing is the caller's
business. `Money` and `LineItem` are the estate's shared shapes, so a line in
`BasketCheckedOut` is the same shape wherever it lands.

A basket carries a version. A write is refused if the basket was changed since
it was read, so two tabs adding to one basket cannot both succeed with the
first add silently disappearing.

### States

`open` → `checked-out` | `abandoned` | `merged`. Only an open basket changes.
A checked-out basket stays readable - the storefront shows it while the order
is being placed - and an abandoned or merged one is a row with a reason, kept
for a while and swept later.

### Rules

Validation lives in the value object constructors and in the aggregate's
methods, so a value that exists is a value that passed. Each rule is a
specification in `rules/` next to what it governs, and `rules/index.ts` is the
policy: which rules currently apply.

- **currency** — ISO 4217, upper case; set by the first item and never
  changed. An item priced in another currency is refused with `409`, not
  converted: a conversion is a rate, and a rate is a fact `pricing` owns.
- **quantity** — a positive integer, at most 99 per line. Adding to a line
  that exists increments it; decrementing to zero is a removal.
- **lines** — at most 50 distinct SKUs. A basket is not a wishlist.
- **price** — captured on the line as `Money` at the moment of adding, from
  what the caller sent. This service does not look prices up; the storefront
  did, and what the customer saw is what is kept.

### Checkout

The one operation that talks to anyone else, in this order:

1. The bearer token is confirmed with `auth` — `GET /v1/sessions/current`.
   A basket can only be checked out by a signed-in customer, and a session
   that ended between page load and click is refused here rather than
   discovered by whoever places the order.
2. The basket must be open and hold at least one line.
3. `pricing` is asked for a quote over the lines - `shop.v1.Pricing/GetQuote`.
   The quote is the total the customer is about to be charged, promotions and
   tax included; the captured line prices are what it is computed from.
4. The basket becomes `checked-out` and `BasketCheckedOut` is written in the
   same transaction, carrying the lines, the total and the quote id.

Step 1 and 3 are the service's only calls out. Both are ports declared by the
use case and filled at assembly; without an address in the environment each
is filled with a permissive stand-in - every session live, the quote equal to
the sum of the lines - so the service runs on a laptop with only Postgres.

### Merge

After login the storefront holds two baskets: the visitor's, by token, and
whatever the customer already had. `MergeBaskets` moves the visitor's lines
into the customer's open basket - creating one when there is none - line by
line under the same rules, and marks the visitor's basket `merged`. A line
that would break the currency rule is refused and the merge stops before it,
with nothing moved: a half-merged basket is worse than a refusal.

### Expiry

A basket untouched for 24 hours is abandoned. Unlike a session's expiry, this
is a decision somebody has to make - a report of abandoned baskets is a real
question - so a sweep runs inside the service, once a minute, marks what it
finds and publishes `BasketAbandoned` for each. The sweep is a use case like
any other; what is unusual is only that nothing calls it from outside.

## Events

Published on the bus under `cart.<Name>`, one version each.

| Event | Carries |
|---|---|
| `BasketCreated` | basket id, token, customer (when signed in), created at |
| `BasketItemAdded` | basket id, sku, quantity after the add, unit price (`Money`) |
| `BasketItemRemoved` | basket id, sku |
| `BasketCheckedOut` | basket id, customer (`CustomerRef`), items (`LineItem[]`), total (`Money`), quote id, checked out at |
| `BasketAbandoned` | basket id, customer (when signed in), idle since |

`BasketCheckedOut` is the one anybody downstream should care about: it is the
handoff to whoever places the order, and `pricing` reads it to expire the
quote it issued.

## HTTP

The API is `src/infrastructure/transport/http/gen/openapi.yaml`, title `cart`,
version 1, so the catalog knows the interface as `cart.v1.Baskets`. Routes,
shapes and status codes are described there; the server's types are generated
from it and the handlers are named by `operationId`, one per use case.

| Operation | Route | Who |
|---|---|---|
| `createBasket` | `POST /v1/baskets` | anyone; answers with the id and the token |
| `getBasket` | `GET /v1/baskets/{basketId}` | the token, or the customer |
| `addItem` | `POST /v1/baskets/{basketId}/items` | the token, or the customer |
| `removeItem` | `DELETE /v1/baskets/{basketId}/items/{sku}` | the token, or the customer |
| `mergeBaskets` | `POST /v1/baskets/{basketId}/merge` | the customer, with the visitor's token in the body |
| `checkout` | `POST /v1/baskets/{basketId}/checkout` | the customer |

"The token" is `X-Basket-Token`, handed out at creation: it is the capability
to change an anonymous basket, and it is compared in constant time. "The
customer" is a bearer token `auth` issued; it is confirmed with `auth` only at
checkout and merge, because those are the two operations where being someone
matters, and every other request would otherwise cost a call out.

## Peers

| Calls | How | In the catalog |
|---|---|---|
| `auth.v1.Sessions/validateSession` | HTTP, `openapi-fetch` over the document vendored in `src/infrastructure/auth/gen/openapi.yaml` | resolves to `auth.auth` |
| `shop.v1.Pricing/GetQuote` | gRPC, Connect-ES over the proto vendored in `src/infrastructure/pricing/proto` | `shop.pricing`, declared |

Both documents are narrowed copies kept beside the client they generate, which
is what lets the catalog name the call the way the callee names the method.
`AUTH_URL` and `PRICING_ADDR` say where the peers are; unset, the stand-ins.

## Persistence

Postgres, one schema, migrations under `src/infrastructure/repository/basket/migrations`,
numbered from 1 and applied at startup.

| Table | Holds |
|---|---|
| `baskets` | the aggregate root: id, token, customer id, currency, status, touched at, version |
| `basket_items` | the lines: basket id, sku, quantity, unit price in minor units and its currency |
| `outbox` | events awaiting the relay: topic, payload, metadata, created at, published at |

An event is written to the outbox in the transaction that changed the basket,
and a relay inside the service reads the outbox and delivers to the bus. The
relay puts the publishing span's trace context on the message, so a consumer
of `BasketCheckedOut` shows up in the same trace as the checkout that caused
it - the same keys `auth` uses, `otel_trace_id` and `otel_span_id`, so a
consumer written in Go and one written here read each other's messages.

## Tracing

`TRACER_URI` names an OTLP collector and switches tracing on. Requests are
traced by route, database calls by the pg instrumentation, and each event
twice: written to the outbox and taken off the bus, with `event.name` on both
spans. `telemetry/` holds the collector config, a recording script and the
recording the catalog is verified against, the same arrangement as `auth`.

## How the catalog reads this

`portolan` reads this tree with `extract-ts` - the layout and the shapes it
goes by are its contract, in `plugins/extract-ts/README.md` - plus
`extract-openapi` for the API, `extract-sql` for the tables and `verify-otel`
for the recording. Nothing here is annotated for the catalog's benefit: the
layout is the claim, and a use case that cannot be read is a use case in the
wrong place.

## Running it

```bash
docker compose up -d
STORE_POSTGRES_URI=postgres://cart:cart@localhost:5433/cart npm start
```

`AUTH_URL=http://localhost:8080` points checkout at a running `auth`; without
it every session is live. `PRICING_ADDR` likewise; without it the quote is the
sum of the lines.

Tests run with `npm test`: the domain and the use cases against fakes, the
repository against a Postgres started by testcontainers, and one end-to-end
run through the HTTP server. Without Docker the repository tests are skipped
and the rest still run.

## Stack

Node 24, TypeScript strict, ESM. Fastify for HTTP; `pg` with a small SQL
migration runner; zod at the edges; `openapi-typescript` for the server's
types and `openapi-fetch` for the client of `auth`; Connect-ES for gRPC; an
outbox and a relay of its own in `src/pkg`; `@opentelemetry/sdk-node` with the
http and pg instrumentations; vitest, with testcontainers. Dependencies are
wired by hand in `src/di`, as functions that build one thing from the things
it needs - there is no container, so the assembly can be read.
