# Dispatch

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.core-dispatch`
- **Owner:** [delivery](../delivery/README.md)
- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts)

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

<a id="step-s1"></a>
1. **client** → **delivery.core** — Dispatch → DispatchResponse
   status: declared · [`examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts:21`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts#L21)
<a id="step-s2"></a>
2. **delivery.core** → **core-pg** — byId
   status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:31`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts#L31)
<a id="step-s3"></a>
3. **delivery.core** → **shop.oms** — GetOrder → GetOrderResponse
   `shop.v1.OrderService/GetOrder` · status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:32`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts#L32)

> **One of**
>
> *standing === "cancelled" — *ends the flow**
>
> <a id="step-s4"></a>
> 4. **delivery.core** → **core-pg** — save
>    status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:36`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts#L36)
> <a id="step-s5"></a>
> 5. **delivery.core** → **bus** — ShipmentLost
>    [`delivery.core.shipment.ShipmentLost`](../delivery/core/aggregates/shipment.md#event-delivery-core-shipment-shipmentlost) · status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:36`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts#L36)
>
> *otherwise*

<a id="step-s7"></a>
6. **delivery.core** → **core-pg** — save
   status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:41`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts#L41)
<a id="step-s8"></a>
7. **delivery.core** → **bus** — ShipmentDispatched
   [`delivery.core.shipment.ShipmentDispatched`](../delivery/core/aggregates/shipment.md#event-delivery-core-shipment-shipmentdispatched) · status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts:41`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/dispatch/usecase.ts#L41)
<a id="step-s9"></a>
8. **delivery.core** → **core-pg** — byId
   status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/get_shipment/usecase.ts:24`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/get_shipment/usecase.ts#L24)
