# Get order

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `flow.oms-get-order`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs`

Answers with the order as it is now; a cancelled order is still found.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.oms` | service | [shop](../shop/README.md) |
| `oms-pg` | store | [shop](../shop/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.oms
    participant p2 as oms-pg
    p0->>p1: GetOrder
    p1->>p2: by_id
```

## Steps

1. **client** → **shop.oms** — GetOrder
   `examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs:31` · Seen running in telemetry/traces.jsonl (2 traces).
2. **shop.oms** → **oms-pg** — by_id
   status: declared · `examples/shop/oms/src/application/order/usecases/get_order/mod.rs:14`
