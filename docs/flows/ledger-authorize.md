# Authorize

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.ledger-authorize`
- **Owner:** [payments](../payments/README.md)
- **Source:** `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java`

Asks the gateway to hold the money for an order, and records either that it agreed or that it refused.

## Participants

| Participant | Kind | Context | Label |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `payments.ledger` | service | [payments](../payments/README.md) | — |
| `ledger-pg` | store | [payments](../payments/README.md) | — |
| `shop.oms` | service | [shop](../shop/README.md) | — |
| `bus` | broker | — | — |
| `psp` | unknown | — | psp |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as payments.ledger
    participant p2 as ledger-pg
    participant p3 as shop.oms
    participant p4 as bus
    participant p5 as psp
    p0->>p1: Authorize → AuthorizeResponse
    p1->>p2: byId
    p1->>p2: byOrder
    p1->>p3: GetOrder → GetOrderResponse
    alt orders.standing(orderId) == Orders.Standing.CANCELLED
        p1->>p2: save
        p1-)p4: PaymentDeclined
        Note over p4: flow ends here
    else otherwise
    end
    p1->>p5: hold
    alt !hold.held()
        p1->>p2: save
        p1-)p4: PaymentDeclined
        Note over p4: flow ends here
    else otherwise
    end
    p1->>p2: save
    p1-)p4: PaymentAuthorized
```

## Steps

1. **client** → **payments.ledger** — Authorize → AuthorizeResponse
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java:34`
2. **payments.ledger** → **ledger-pg** — byId
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:45`
3. **payments.ledger** → **ledger-pg** — byOrder
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:50`
4. **payments.ledger** → **shop.oms** — GetOrder → GetOrderResponse
   `shop.v1.OrderService/GetOrder` · status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:54`

> **One of**
>
> *orders.standing(orderId) == Orders.Standing.CANCELLED — *ends the flow**
>
> 5. **payments.ledger** → **ledger-pg** — save
>    status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:56`
> 6. **payments.ledger** → **bus** — PaymentDeclined
>    [payments.ledger.payment.PaymentDeclined](../payments/ledger/aggregates/payment.md) · status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:57`
>
> *otherwise*

7. **payments.ledger** → **psp** — hold
   status: unresolved · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:62`

> **One of**
>
> *!hold.held() — *ends the flow**
>
> 8. **payments.ledger** → **ledger-pg** — save
>    status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:65`
> 9. **payments.ledger** → **bus** — PaymentDeclined
>    [payments.ledger.payment.PaymentDeclined](../payments/ledger/aggregates/payment.md) · status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:66`
>
> *otherwise*

10. **payments.ledger** → **ledger-pg** — save
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:70`
11. **payments.ledger** → **bus** — PaymentAuthorized
   [payments.ledger.payment.PaymentAuthorized](../payments/ledger/aggregates/payment.md) · status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:71`
