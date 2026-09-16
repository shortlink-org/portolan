# Authorize

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.ledger-authorize`
- **Owner:** [payments](../payments/README.md)
- **Trigger:** `callback` · gRPC · Authorize
- **Root confidence:** high
- **Source:** [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java)

Asks the gateway to hold the money for an order, and records either that it agreed or that it refused.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `payments.ledger` | service | [payments](../payments/README.md) | — |
| `ledger-pg` | store | [payments](../payments/README.md) | [payments.ledger.pg](../payments/ledger/stores/pg.md) |
| `shop.oms` | service | [shop](../shop/README.md) | — |
| `bus` | broker | — | — |
| `stripe` | external | — | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as payments.ledger
    participant p2 as ledger-pg
    participant p3 as shop.oms
    participant p4 as bus
    participant p5 as stripe
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
    p1->>p5: PostPaymentIntents → payment_intent
    alt !hold.held()
        p1->>p2: save
        p1-)p4: PaymentDeclined
        Note over p4: flow ends here
    else otherwise
    end
    p1->>p2: save
    p1->>p3: GetOrder → GetOrderResponse
    alt orders.standing(orderId) == Orders.Standing.CANCELLED
        p1->>p5: PostPaymentIntentsIntentCancel → payment_intent
        p1->>p2: save
        Note over p2: flow ends here
    else otherwise
    end
    p1-)p4: PaymentAuthorized
```

## Steps

<a id="step-s1"></a>
1. **client** → **payments.ledger** — Authorize → AuthorizeResponse
   `payments.v1.PaymentService/Authorize` · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java:34`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java#L34)
<a id="step-s2"></a>
2. **payments.ledger** → **ledger-pg** — byId
   status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:50`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L50)
<a id="step-s3"></a>
3. **payments.ledger** → **ledger-pg** — byOrder
   status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:55`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L55)
<a id="step-s4"></a>
4. **payments.ledger** → **shop.oms** — GetOrder → GetOrderResponse
   `shop.v1.OrderService/GetOrder` · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:59`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L59)

> **One of**
>
> *orders.standing(orderId) == Orders.Standing.CANCELLED — *ends the flow**
>
> <a id="step-s5"></a>
> 5. **payments.ledger** → **ledger-pg** — save
>    status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:61`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L61)
> <a id="step-s6"></a>
> 6. **payments.ledger** → **bus** — PaymentDeclined
>    [`payments.ledger.payment.PaymentDeclined`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentdeclined) · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:62`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L62)
>
> *otherwise*

<a id="step-s8"></a>
7. **payments.ledger** → **stripe** — PostPaymentIntents → payment_intent
   `stripe.v1/PostPaymentIntents` · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:67`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L67)

> **One of**
>
> *!hold.held() — *ends the flow**
>
> <a id="step-s9"></a>
> 8. **payments.ledger** → **ledger-pg** — save
>    status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:70`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L70)
> <a id="step-s10"></a>
> 9. **payments.ledger** → **bus** — PaymentDeclined
>    [`payments.ledger.payment.PaymentDeclined`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentdeclined) · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:71`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L71)
>
> *otherwise*

<a id="step-s12"></a>
10. **payments.ledger** → **ledger-pg** — save
   status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:75`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L75)
<a id="step-s13"></a>
11. **payments.ledger** → **shop.oms** — GetOrder → GetOrderResponse
   `shop.v1.OrderService/GetOrder` · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:76`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L76)

> **One of**
>
> *orders.standing(orderId) == Orders.Standing.CANCELLED — *ends the flow**
>
> <a id="step-s14"></a>
> 12. **payments.ledger** → **stripe** — PostPaymentIntentsIntentCancel → payment_intent
>    `stripe.v1/PostPaymentIntentsIntentCancel` · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:78`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L78)
> <a id="step-s15"></a>
> 13. **payments.ledger** → **ledger-pg** — save
>    status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:79`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L79)
>
> *otherwise*

<a id="step-s17"></a>
14. **payments.ledger** → **bus** — PaymentAuthorized
   [`payments.ledger.payment.PaymentAuthorized`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentauthorized) · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java:82`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/AuthorizePayment.java#L82)
