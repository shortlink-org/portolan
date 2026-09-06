# Record delivery

*Generated from the portolan catalog · commit `11 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.core-record-delivery`
- **Owner:** [delivery](../delivery/README.md)
- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts)

Ends a shipment at the door.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `delivery.core` | service | [delivery](../delivery/README.md) |
| `core-pg` | store | [delivery](../delivery/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as delivery.core
    participant p2 as core-pg
    participant p3 as bus
    p0->>p1: RecordDelivery → RecordDeliveryResponse
    p1->>p2: byId
    p1->>p2: save
    p1-)p3: ShipmentDelivered
```

## Steps

<a id="step-s1"></a>
1. **client** → **delivery.core** — RecordDelivery → RecordDeliveryResponse
   status: declared · [`examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts:36`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts#L36)
<a id="step-s2"></a>
2. **delivery.core** → **core-pg** — byId
   status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/record_delivery/usecase.ts:11`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/record_delivery/usecase.ts#L11)
<a id="step-s3"></a>
3. **delivery.core** → **core-pg** — save
   status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/record_delivery/usecase.ts:13`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/record_delivery/usecase.ts#L13)
<a id="step-s4"></a>
4. **delivery.core** → **bus** — ShipmentDelivered
   [`delivery.core.shipment.ShipmentDelivered`](../delivery/core/aggregates/shipment.md#event-delivery-core-shipment-shipmentdelivered) · status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/record_delivery/usecase.ts:13`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/record_delivery/usecase.ts#L13)
