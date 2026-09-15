# Cancel order on payment declined

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.oms-cancel-order-on-payment-declined`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `event` · PaymentDeclined
- **Root confidence:** high
- **Source:** [`examples/shop/oms/src/application/policy/cancel_order_on_payment_declined.rs`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/cancel_order_on_payment_declined.rs)

Cancels the order whose payment ledger declined (ADR oms.0007). The same fact heard twice, or after the RPC answer already cancelled, changes nothing.

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
    p0-)p1: PaymentDeclined
    p1->>p1: CancelOrder
    p1->>p2: by_id
    alt order.status is Status::Cancelled
    else otherwise
        p1->>p2: save
        p1-)p0: OrderCancelled
    end
```

## Steps

<a id="step-s1"></a>
1. **bus** → **shop.oms** — PaymentDeclined
   [`payments.ledger.payment.PaymentDeclined`](../payments/ledger/aggregates/payment.md#event-payments-ledger-payment-paymentdeclined) · status: declared · [`examples/shop/oms/src/application/policy/cancel_order_on_payment_declined.rs:17`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/cancel_order_on_payment_declined.rs#L17)
<a id="step-s2"></a>
2. **shop.oms** ↺ **shop.oms** — CancelOrder
   `shop.oms.order/CancelOrder` · status: declared · [`examples/shop/oms/src/application/policy/cancel_order_on_payment_declined.rs:18`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/cancel_order_on_payment_declined.rs#L18)
<a id="step-s3"></a>
3. **shop.oms** → **oms-pg** — by_id
   status: declared · [`examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:35`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs#L35)

> **One of**
>
> *order.status is Status::Cancelled — *ends the flow**
>
>
> *otherwise*
>
> <a id="step-s4"></a>
> 4. **shop.oms** → **oms-pg** — save
>    status: declared · [`examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs#L50)
> <a id="step-s5"></a>
> 5. **shop.oms** → **bus** — OrderCancelled
>    [`shop.oms.order.OrderCancelled`](../shop/oms/aggregates/order.md#event-shop-oms-order-ordercancelled) · status: declared · [`examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs#L50)
