# bff.0001 — GraphQL over Yoga, and the schema comes first

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [storefront.bff](../storefront/bff/README.md)
- **Source:** `examples/bff/docs/adr/0001-graphql-yoga-schema-first.md`

### Context and Problem Statement

A storefront screen is four services deep: who the customer is, what is in
the basket, what became of the order, where the parcel got to. Asking a
browser to make four calls, in order, over two protocols, and to know which
of them may fail without the screen failing, is asking the browser to hold
the estate's shape. Something has to hold it instead.

The estate already speaks two contract languages - OpenAPI over HTTP,
protobuf over gRPC - and both are written first and generated from. A third
edge should not be a third way of working.

### Decision Outcome

GraphQL, schema-first, served by Yoga.

The schema is SDL on disk, one module per directory under `src/schema`, and
it is the source: `graphql-codegen` with `server-preset` reads it and writes
the resolver types and the file each resolver lives in. A field added to the
SDL is a file that appears; a field removed is a resolver that stops being
wired in. Nothing is written by hand that the schema already says.

Yoga rather than Apollo Server or Mercurius: it is the smallest of the three
that still has an envelop plugin chain and subscriptions without a second
protocol, and it is a request handler over the Fetch API rather than a
framework, so the transport file stays a page long.

What this buys the catalog is the same thing an OpenAPI document buys it: a
document to read. `extract-graphql` reads the SDL for what the service
provides, and `extract-ts` reads the resolvers beside it for what each field
goes on to call. Neither could be written against a schema that only existed
once the server was up.

#### Consequences

- Good: one round trip for a screen, and the fan-out is a fact in the
  catalog rather than a diagram in a wiki.
- Good: the client contract is reviewed as a diff of the SDL.
- Bad: a fourth generator in the estate, and a resolver file whose head is
  generated and whose body is not - a reader has to know which half is which.
- Note: the resolvers are scaffolded once and then owned by people. Codegen
  regenerates only the `*.generated.ts` files beside them.
