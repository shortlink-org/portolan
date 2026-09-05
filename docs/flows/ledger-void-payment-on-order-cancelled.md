# Void payment on order cancelled

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.ledger-void-payment-on-order-cancelled`
- **Owner:** [payments](../payments/README.md)
- **Source:** `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/policy/VoidPaymentOnOrderCancelled.java`

Gives back what was held once the order it was held for is gone.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `bus` | broker | — |
| `payments.ledger` | service | [payments](../payments/README.md) |
| `ledger-pg` | store | [payments](../payments/README.md) |
| `stripe` | external | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as bus
    participant p1 as payments.ledger
    participant p2 as ledger-pg
    participant p3 as stripe
    p0-)p1: OrderCancelled
    p1->>p2: byOrder
    p1->>p3: PostPaymentIntentsIntentCancel → payment_intent
    p1->>p2: save
```

## Steps

1. **bus** → **payments.ledger** — OrderCancelled
   [shop.oms.order.OrderCancelled](../shop/oms/aggregates/order.md) · status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/policy/VoidPaymentOnOrderCancelled.java:25`
2. **payments.ledger** → **ledger-pg** — byOrder
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/VoidPayment.java:29`
3. **payments.ledger** → **stripe** — PostPaymentIntentsIntentCancel → payment_intent
   `stripe.v1/PostPaymentIntentsIntentCancel` · status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/VoidPayment.java:35`
4. **payments.ledger** → **ledger-pg** — save
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/payment/usecase/VoidPayment.java:36`
