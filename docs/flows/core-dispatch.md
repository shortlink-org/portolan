# Dispatch

*Generated from the portolan catalog · commit `9 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `flow.core-dispatch`
- **Owner:** [delivery](../delivery/README.md)
- **Source:** `examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts`

One shipment, for whoever is asking about an order.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `delivery.core` | service | [delivery](../delivery/README.md) |
| `core-pg` | store | [delivery](../delivery/README.md) |
| `shop.oms` | service | [shop](../shop/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as delivery.core
    participant p2 as core-pg
    participant p3 as shop.oms
    participant p4 as bus
    p0->>p1: Dispatch → DispatchResponse
    p1->>p2: byId
    p1->>p3: GetOrder → GetOrderResponse
    alt order.status === "cancelled"
        p1->>p2: save
        Note over p2: flow ends here
    else otherwise
    end
    p1->>p2: save
    p1-)p4: ShipmentDispatched
    p1->>p2: byId
```

## Steps

1. **client** → **delivery.core** — Dispatch → DispatchResponse
   status: declared · `examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts:21`
2. **delivery.core** → **core-pg** — byId
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:27`
3. **delivery.core** → **shop.oms** — GetOrder → GetOrderResponse
   `shop.v1.OrderService/GetOrder` · status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:28`

> **One of**
>
> *order.status === "cancelled" — *ends the flow**
>
> 4. **delivery.core** → **core-pg** — save
>    status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:32`
>
> *otherwise*

5. **delivery.core** → **core-pg** — save
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:37`
6. **delivery.core** → **bus** — ShipmentDispatched
   [delivery.core.shipment.ShipmentDispatched](../delivery/core/aggregates/shipment.md) · status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:37`
7. **delivery.core** → **core-pg** — byId
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/get_shipment/usecase.ts:9`
