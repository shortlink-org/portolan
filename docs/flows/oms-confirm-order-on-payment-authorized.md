# Confirm order on payment authorized

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.oms-confirm-order-on-payment-authorized`
- **Owner:** [shop](../shop/README.md)
- **Source:** `examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs`

Confirms the order once the payment for it is authorised (ADR oms.0005). The publisher is `payments.ledger`, and the name is the one it puts on the message: every service on this bus names its events after itself.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `bus` | broker | — |
| `shop.oms` | service | [shop](../shop/README.md) |
| `oms-pg` | store | [shop](../shop/README.md) |
| `payments.ledger` | service | [payments](../payments/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as bus
    participant p1 as shop.oms
    participant p2 as oms-pg
    participant p3 as payments.ledger
    p0-)p1: PaymentAuthorized
    p1->>p1: ConfirmOrder
    p1->>p2: by_id
    p1->>p3: Authorize → AuthorizeResponse
    p1->>p2: save
    p1-)p0: OrderConfirmed
```

## Steps

1. **bus** → **shop.oms** — PaymentAuthorized
   [payments.ledger.payment.PaymentAuthorized](../payments/ledger/aggregates/payment.md) · status: declared · `examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs:20` · Reacts to the message named `ledger.PaymentAuthorized`, which is not an event this repository declares.
2. **shop.oms** ↺ **shop.oms** — ConfirmOrder
   status: declared · `examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs:27`
3. **shop.oms** → **oms-pg** — by_id
   status: declared · `examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:31`
4. **shop.oms** → **payments.ledger** — Authorize → AuthorizeResponse
   `payments.v1.PaymentService/Authorize` · status: declared · `examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:32`
5. **shop.oms** → **oms-pg** — save
   status: declared · `examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:34`
6. **shop.oms** → **bus** — OrderConfirmed
   [shop.oms.order.OrderConfirmed](../shop/oms/aggregates/order.md) · status: declared · `examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:34`
