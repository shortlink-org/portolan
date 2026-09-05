# Record scan

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.core-record-scan`
- **Owner:** [delivery](../delivery/README.md)
- **Source:** `examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts`

Writes down that a parcel was seen somewhere.

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
    p0->>p1: RecordScan → RecordScanResponse
    p1->>p2: byId
    alt moved
        p1->>p2: save
        p1-)p3: ShipmentInTransit
        Note over p3: flow ends here
    else otherwise
    end
    p1->>p2: save
```

## Steps

1. **client** → **delivery.core** — RecordScan → RecordScanResponse
   status: declared · `examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/handlers.ts:29`
2. **delivery.core** → **core-pg** — byId
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/record_scan/usecase.ts:17`

> **One of**
>
> *moved — *ends the flow**
>
> 3. **delivery.core** → **core-pg** — save
>    status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/record_scan/usecase.ts:20`
> 4. **delivery.core** → **bus** — ShipmentInTransit
>    [delivery.core.shipment.ShipmentInTransit](../delivery/core/aggregates/shipment.md) · status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/record_scan/usecase.ts:20`
>
> *otherwise*

5. **delivery.core** → **core-pg** — save
   status: declared · `examples/shop/delivery/core/src/application/shipment/usecases/record_scan/usecase.ts:23`
