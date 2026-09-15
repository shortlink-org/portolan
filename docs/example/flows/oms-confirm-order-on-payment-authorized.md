# Confirm order on payment authorized

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.oms-confirm-order-on-payment-authorized`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `event` · PaymentAuthorized
- **Root confidence:** high
- **Source:** [`examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs)

Applies the ledger's public fact; it never calls Authorize.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `bus` | broker | — | — |
| `shop.oms` | service | [shop](../shop/README.md) | — |
| `oms-pg` | store | [shop](../shop/README.md) | [shop.oms.pg](../shop/oms/stores/pg.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as bus
    participant p1 as shop.oms
    participant p2 as oms-pg
    p0-)p1: PaymentAuthorized
    p1->>p1: ConfirmOrder
    p1->>p2: by_id
    p1->>p2: save
    p1-)p0: OrderConfirmed
```

## Steps

<a id="step-s1"></a>
1. **bus** → **shop.oms** — PaymentAuthorized
   [`payments.ledger.payment.PaymentAuthorized`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentauthorized) · status: declared · [`examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs:16`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs#L16)
<a id="step-s2"></a>
2. **shop.oms** ↺ **shop.oms** — ConfirmOrder
   `shop.oms.order/ConfirmOrder` · status: declared · [`examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs:17`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/confirm_order_on_payment_authorized.rs#L17)
<a id="step-s3"></a>
3. **shop.oms** → **oms-pg** — by_id
   status: declared · [`examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:26`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs#L26)
<a id="step-s4"></a>
4. **shop.oms** → **oms-pg** — save
   status: declared · [`examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:38`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs#L38)
<a id="step-s5"></a>
5. **shop.oms** → **bus** — OrderConfirmed
   [`shop.oms.order.OrderConfirmed`](../shop/oms/aggregates/order.md#event-shop-oms-order-orderconfirmed) · status: declared · [`examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:38`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs#L38)
