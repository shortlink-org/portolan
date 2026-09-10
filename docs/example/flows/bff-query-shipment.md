# Query shipment

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.bff-query-shipment`
- **Owner:** [storefront](../storefront/README.md)
- **Source:** [`examples/bff/src/schema/delivery/resolvers/Query/shipment.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/delivery/resolvers/Query/shipment.ts)

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `storefront.bff` | service | [storefront](../storefront/README.md) |
| `delivery.core` | service | [delivery](../delivery/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as storefront.bff
    participant p2 as delivery.core
    p0->>p1: Query.shipment → Shipment
    p1->>p2: GetShipment → GetShipmentResponse
```

## Steps

<a id="step-s1"></a>
1. **client** → **storefront.bff** — Query.shipment → Shipment
   status: declared · [`examples/bff/src/schema/delivery/resolvers/Query/shipment.ts:3`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/delivery/resolvers/Query/shipment.ts#L3)
<a id="step-s2"></a>
2. **storefront.bff** → **delivery.core** — GetShipment → GetShipmentResponse
   `delivery.v1.Delivery/GetShipment` · status: declared · [`examples/bff/src/schema/delivery/resolvers/Query/shipment.ts:4`](https://github.com/shortlink-org/portolan/blob/main/examples/bff/src/schema/delivery/resolvers/Query/shipment.ts#L4)
