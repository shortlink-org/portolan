# Dispatch

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

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
    alt standing === "cancelled"
        p1->>p2: save
        p1-)p4: ShipmentLost
        Note over p4: flow ends here
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
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:31`
3. **delivery.core** → **shop.oms** — GetOrder → GetOrderResponse
   `shop.v1.OrderService/GetOrder` · status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:32`

> **One of**
>
> *standing === "cancelled" — *ends the flow**
>
> 4. **delivery.core** → **core-pg** — save
>    status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:36`
> 5. **delivery.core** → **bus** — ShipmentLost
>    [delivery.core.shipment.ShipmentLost](../delivery/core/aggregates/shipment.md) · status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:36`
>
> *otherwise*

6. **delivery.core** → **core-pg** — save
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:41`
7. **delivery.core** → **bus** — ShipmentDispatched
   [delivery.core.shipment.ShipmentDispatched](../delivery/core/aggregates/shipment.md) · status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:41`
8. **delivery.core** → **core-pg** — byId
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/get_shipment/usecase.ts:24`
