# cart.0001 — TypeScript on Node.js, and the stack around it

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** [shop.cart](../shop/cart/README.md)
- **Source:** `examples/shop/cart/docs/adr/0001-typescript-on-node.md`

### Context and Problem Statement

Every service in the estate so far is Go, and the catalog's extractors were
written against Go's layout. The cart is the first service with a different
team behind it and a different runtime, and it is also the test of whether the
catalog describes an estate or a language.

### Decision Drivers

- The catalog must read this service without annotations, as it reads the Go
  ones: the layout is the claim.
- Peers are called the way their contracts are written - OpenAPI for HTTP,
  proto for gRPC - so the call is named the way the callee names the method.
- The service must run on a laptop with one Postgres and nothing else.

### Considered Options

1. **Go**, like the rest.
2. **TypeScript on Node.js**, with the same layout one directory over.
3. **TypeScript** with a framework that owns the layout (NestJS).

### Decision Outcome

Chosen option: **TypeScript on Node.js**, plain.

Node 24 with strict TypeScript and ESM; Fastify for HTTP; `pg` with a small
SQL migration runner; zod at the edges; `openapi-typescript` for the server's
types and `openapi-fetch` for the client of `auth`; Connect-ES for gRPC; an
outbox and a relay of the service's own; `@opentelemetry/sdk-node` with the
http and pg instrumentations; vitest with testcontainers. Dependencies are
wired by hand in `src/di`, as functions that build one thing from the things
it needs.

Option 3 was declined because a framework that owns the layout owns what the
catalog can read, and its decorators are annotations by another name.

#### Consequences

- Good: the catalog gets a second extractor, `extract-ts`, held to the same
  contract as `extract-go`, and the estate stops being a Go estate.
- Good: the assembly is readable, so a port bound to an adapter is a fact in
  one function rather than in a container's registration order.
- Bad: two runtimes to keep instrumented and traced alike; the trace context
  on outbox messages uses the keys the Go services use, so a consumer in
  either language reads the other's messages.
