# Cancel order

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.oms-cancel-order`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs`

Reads one order by id.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.oms` | service | [shop](../shop/README.md) |
| `oms-pg` | store | [shop](../shop/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.oms
    participant p2 as oms-pg
    participant p3 as bus
    p0->>p1: CancelOrder → CancelOrderResponse
    p1->>p2: by_id
    alt order.status is Status::Cancelled
    else otherwise
        p1->>p2: save
        p1-)p3: OrderCancelled
    end
    p1->>p2: by_id
```

## Steps

1. **client** → **shop.oms** — CancelOrder → CancelOrderResponse
   `examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs:41` · Seen running in telemetry/traces.jsonl (1 trace).
2. **shop.oms** → **oms-pg** — by_id
   status: declared · `examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:21`

> **One of**
>
> *order.status is Status::Cancelled — *ends the flow**
>
>
> *otherwise*
>
> 3. **shop.oms** → **oms-pg** — save
>    status: declared · `examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:26`
> 4. **shop.oms** → **bus** — OrderCancelled
>    [shop.oms.order.OrderCancelled](../shop/oms/aggregates/order.md) · `examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:26` · Seen running in telemetry/traces.jsonl (1 trace).

5. **shop.oms** → **oms-pg** — by_id
   status: declared · `examples/shop/oms/src/application/order/usecases/get_order/mod.rs:42`
