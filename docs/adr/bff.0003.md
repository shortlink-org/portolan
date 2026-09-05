# bff.0003 — The schema speaks the client's words, not the peers'

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [storefront.bff](../storefront/bff/README.md)
- **Source:** `examples/bff/docs/adr/0003-the-schema-speaks-the-clients-words.md`

### Context and Problem Statement

The same amount of money is `amountMinor` in the cart's document and
`amount_minor` in the order service's proto. A basket's lines are `items`
over HTTP and `lines` over gRPC. A basket is `checked-out` in one place and
would be `CHECKED_OUT` in a GraphQL enum. Three vocabularies meet in this
service, and there are two ways to handle it: generate the schema from the
peers' documents and let a client learn all three, or write one and translate.

Generating would have been cheap: `openapi-to-graphql` and the mesh tools do
exactly that, and the schema would follow the peers for free.

### Decision Outcome

One vocabulary, written by hand in the SDL, and translated at the adapter.

`Money` is spelled once. `Basket.lines` is `lines` whichever peer the lines
came from. `BasketStatus` is upper case because that is what a GraphQL enum
looks like, not because the cart says so. Every one of those renamings
happens in `src/infrastructure/<peer>/client.ts` and nowhere else, which is
the same rule the cart follows for auth and pricing.

What is not translated is what this service has no opinion about. Delivery
answers with its own word for where a parcel is, and `Shipment.state` is a
`String`: an enum here would be a promise about a set of values that another
service owns.

#### Consequences

- Good: a client reads one vocabulary, and the glossary is short enough to
  read in a minute.
- Good: a peer renaming a field is one adapter changing, not every client.
- Bad: a field a peer adds does not appear until somebody adds it here; the
  schema is a decision, not a mirror.
