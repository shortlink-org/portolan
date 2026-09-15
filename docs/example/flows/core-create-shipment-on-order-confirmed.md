# Create shipment on order confirmed

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.core-create-shipment-on-order-confirmed`
- **Owner:** [delivery](../delivery/README.md)
- **Trigger:** `event` · OrderConfirmed
- **Root confidence:** high
- **Source:** [`examples/shop/delivery/core/src/application/policy/create-shipment-on-order-confirmed.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/policy/create-shipment-on-order-confirmed.ts)

A confirmed order becomes something to carry, and the money for it is asked to move (ADR core.0003).

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `bus` | broker | — | — |
| `delivery.core` | service | [delivery](../delivery/README.md) | — |
| `core-pg` | store | [delivery](../delivery/README.md) | [delivery.core.pg](../delivery/core/stores/pg.md) |
| `payments.ledger` | service | [payments](../payments/README.md) | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as bus
    participant p1 as delivery.core
    participant p2 as core-pg
    participant p3 as payments.ledger
    p0-)p1: OrderConfirmed
    p1->>p1: CreateShipment
    p1->>p2: findByOrder
    alt !shipment
        p1->>p2: save
        p1-)p0: ShipmentCreated
    else otherwise
    end
    p1->>p3: Capture → CaptureResponse
```

## Steps

<a id="step-s1"></a>
1. **bus** → **delivery.core** — OrderConfirmed
   [`shop.oms.order.OrderConfirmed`](../shop/oms/aggregates/order.md#event-shop-oms-order-orderconfirmed) · status: declared · [`examples/shop/delivery/core/src/application/policy/create-shipment-on-order-confirmed.ts:18`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/policy/create-shipment-on-order-confirmed.ts#L18)
<a id="step-s2"></a>
2. **delivery.core** ↺ **delivery.core** — CreateShipment
   status: declared · [`examples/shop/delivery/core/src/application/policy/create-shipment-on-order-confirmed.ts:21`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/policy/create-shipment-on-order-confirmed.ts#L21)
<a id="step-s3"></a>
3. **delivery.core** → **core-pg** — findByOrder
   status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts:56`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts#L56)

> **One of**
>
> *!shipment*
>
> <a id="step-s4"></a>
> 4. **delivery.core** → **core-pg** — save
>    status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts:59`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts#L59)
> <a id="step-s5"></a>
> 5. **delivery.core** → **bus** — ShipmentCreated
>    [`delivery.core.shipment.ShipmentCreated`](../delivery/core/aggregates/shipment.md#event-delivery-core-shipment-shipmentcreated) · status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts:59`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts#L59)
>
> *otherwise*

<a id="step-s7"></a>
6. **delivery.core** → **payments.ledger** — Capture → CaptureResponse
   `payments.v1.PaymentService/Capture` · status: declared · [`examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts:67`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/shipment/usecases/create_shipment/usecase.ts#L67)
