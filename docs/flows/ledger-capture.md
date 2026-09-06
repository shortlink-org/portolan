# Capture

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.ledger-capture`
- **Owner:** [payments](../payments/README.md)
- **Source:** [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java)

Moves the money the gateway was holding, writes the pair of postings for it, and says so on the bus.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `payments.ledger` | service | [payments](../payments/README.md) |
| `ledger-pg` | store | [payments](../payments/README.md) |
| `stripe` | external | — |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as payments.ledger
    participant p2 as ledger-pg
    participant p3 as stripe
    participant p4 as bus
    p0->>p1: Capture → CaptureResponse
    p1->>p2: byId
    p1->>p3: PostPaymentIntentsIntentCapture → payment_intent
    p1->>p2: save
    p1-)p4: PaymentCaptured
```

## Steps

<a id="step-s1"></a>
1. **client** → **payments.ledger** — Capture → CaptureResponse
   status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java:53`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/PaymentGrpcService.java#L53)
<a id="step-s2"></a>
2. **payments.ledger** → **ledger-pg** — byId
   status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java:38`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java#L38)
<a id="step-s3"></a>
3. **payments.ledger** → **stripe** — PostPaymentIntentsIntentCapture → payment_intent
   `stripe.v1/PostPaymentIntentsIntentCapture` · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java:43`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java#L43)
<a id="step-s4"></a>
4. **payments.ledger** → **ledger-pg** — save
   status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java:44`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java#L44)
<a id="step-s5"></a>
5. **payments.ledger** → **bus** — PaymentCaptured
   [`payments.ledger.payment.PaymentCaptured`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentcaptured) · status: declared · [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java:45`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/CapturePayment.java#L45)
