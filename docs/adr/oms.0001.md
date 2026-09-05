# oms.0001 — Rust on Tokio, and the stack around it

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [shop.oms](../shop/oms/README.md)
- **Source:** `examples/shop/oms/docs/adr/0001-rust-on-tokio.md`

### Context and Problem Statement

The estate has a Go service and a TypeScript one, each read by an extractor
of its own. A third service is a chance to hold the layered layout to a third
language, and the catalog to a third reader. Which language, and on what?

### Decision Outcome

Rust, on Tokio. The edge is tonic over the contract published to the registry
(`buf.build/shortlink-org/portolan-shop-order`), generated at the pinned
commit and committed. The store is Postgres through sqlx, plain queries with
`bind`, not the checked macros: those need a database or a cache at compile
time, and the column maps the catalog reads come off the plain form. Events
leave through an outbox and a relay, over NATS JetStream, the same shape as
the cart's (cart.0008). Tracing is `tracing` with the OpenTelemetry layer,
sent by OTLP when a collector is named.

Ports are traits whose methods return `impl Future + Send`, because a use
case runs wherever tonic puts it, and a future that may cross a thread has to
say so. There is no container: main.rs builds every adapter and hands it in,
and what fills a port is the one thing Rust makes explicit, `impl Port for
Adapter`. The catalog reads the bindings off those.

#### Consequences

- Good: the same layout in a third language, read by a third extractor with
  the same rules; a compile-time check on every port.
- Bad: generics where the other services have interfaces: a use case is
  `UseCase<O: Orders, P: Payments>`, and the assembly spells the types out.
- Note: the lifecycle table is a slice of `(state, &[states])`; the enum
  behind it is the type the code switches on.
