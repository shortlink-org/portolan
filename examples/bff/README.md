# Storefront BFF

Service `bff` — bounded context **storefront**. TypeScript on Node, GraphQL
over Yoga.

One graph in front of four services, for one kind of client: the storefront.
It holds no data of its own. Everything it answers with, it asked somebody
else for a moment earlier, in that somebody's own vocabulary, and translated.

## What it does

- Answers `viewer`, `basket`, `order` and `shipment` over one GraphQL
  endpoint, so a screen costs one round trip instead of four.
- Takes `addItem`, `removeItem`, `checkout` and `cancelOrder`, and passes the
  refusals back from whoever made them.
- Forwards the order's moves to `Subscription.orderStatus`, off the bus the
  order service already publishes to (bff.0004).
- Speaks one vocabulary at its edge and translates each peer's at the adapter
  (bff.0003).

## What it does not do

Owns nothing: no aggregate, no database, no event of its own (bff.0002).
Mints no session and holds no credential - auth is asked on every request.
Prices nothing, places no order, ships nothing: the cart, the order service
and delivery each decide their own, and this service carries the answers.

## Decisions

- [bff.0001](docs/adr/0001-graphql-yoga-schema-first.md) — GraphQL over Yoga, and the schema comes first
- [bff.0002](docs/adr/0002-the-storefront-owns-no-state.md) — The storefront owns no state
- [bff.0003](docs/adr/0003-the-schema-speaks-the-clients-words.md) — The schema speaks the client's words, not the peers'
- [bff.0004](docs/adr/0004-subscriptions-are-the-bus-forwarded.md) — A subscription is the bus, forwarded

## The tree

```
src/
  schema/<module>/schema.graphql        the contract; read by extract-graphql
  schema/<module>/resolvers/<Root>/<field>.ts
                                        one file per field, scaffolded by codegen,
                                        body written here; read by extract-ts
  ports/*.ts                            what a resolver may reach
  infrastructure/<peer>/                the vendored contract, the generated client,
                                        and the adapter that translates
  infrastructure/bus/                   the one subject this service listens to
  infrastructure/transport/graphql/     the context, and Yoga
  di/container.ts                       which adapter fills which port
```

## Running it

```bash
npm install
npm run generate     # resolvers from the schema, clients from the peers' contracts
npm start
```

`AUTH_URL`, `CART_URL`, `OMS_ADDR` and `DELIVERY_ADDR` say where the peers
are; each defaults to the port that service listens on locally. `NATS_URL`
switches subscriptions on - without it a subscription is answered and nothing
ever arrives on it. `TRACER_URI` switches tracing on and points at whichever collector in the
estate is running - this service brings none of its own. `PORT` defaults to
8085, and the endpoint is `/graphql`.

```bash
npm test             # the schema over the transport, with the peers stood in for
npm run typecheck
```

Generated files are committed, as everywhere in this repository: the clients
under `src/infrastructure/*/gen`, and every `*.generated.ts` beside the
schema. `npm run generate` reproduces them.
