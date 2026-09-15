# Request payment on order placed

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.oms-request-payment-on-order-placed`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `event` · OrderPlaced
- **Root confidence:** high
- **Source:** [`examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs)

The stored OrderPlaced triggers the RPC. Applying its answer also recovers a ledger save whose subsequent event publication failed.

## Participants

| Participant | Kind | Context | Entity |
| --- | --- | --- | --- |
| `bus` | broker | — | — |
| `shop.oms` | service | [shop](../shop/README.md) | — |
| `oms-pg` | store | [shop](../shop/README.md) | [shop.oms.pg](../shop/oms/stores/pg.md) |
| `payments.ledger` | service | [payments](../payments/README.md) | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as bus
    participant p1 as shop.oms
    participant p2 as oms-pg
    participant p3 as payments.ledger
    p0-)p1: OrderPlaced
    p1->>p1: RequestPayment
    p1->>p2: by_id
    p1->>p3: Authorize → AuthorizeResponse
    alt self.request.handle(&event.order_id).await? is Some((Authorization::Authorized { payment_id }, amount))
        p1->>p1: ConfirmOrder
        p1->>p2: by_id
        p1->>p2: save
        p1-)p0: OrderConfirmed
    else self.request.handle(&event.order_id).await? is Some((Authorization::Declined(reason), _))
        p1->>p1: CancelOrder
        p1->>p2: by_id
        alt order.status is Status::Cancelled
        else otherwise
            p1->>p2: save
            p1-)p0: OrderCancelled
        end
    else self.request.handle(&event.order_id).await? is None
    else otherwise
    end
```

## Steps

<a id="step-s1"></a>
1. **bus** → **shop.oms** — OrderPlaced
   [`shop.oms.order.OrderPlaced`](../shop/oms/aggregates/order.md#event-shop-oms-order-orderplaced) · status: declared · [`examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs:28`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs#L28)
<a id="step-s2"></a>
2. **shop.oms** ↺ **shop.oms** — RequestPayment
   `shop.oms.order/RequestPayment` · status: declared · [`examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs:29`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs#L29)
<a id="step-s3"></a>
3. **shop.oms** → **oms-pg** — by_id
   status: declared · [`examples/shop/oms/src/application/order/usecases/request_payment/mod.rs:49`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/request_payment/mod.rs#L49)
<a id="step-s4"></a>
4. **shop.oms** → **payments.ledger** — Authorize → AuthorizeResponse
   `payments.v1.PaymentService/Authorize` · status: declared · [`examples/shop/oms/src/application/order/usecases/request_payment/mod.rs:53`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/request_payment/mod.rs#L53)

> **One of**
>
> *self.request.handle(&event.order_id).await? is Some((Authorization::Authorized { payment_id }, amount))*
>
> <a id="step-s5"></a>
> 5. **shop.oms** ↺ **shop.oms** — ConfirmOrder
>    `shop.oms.order/ConfirmOrder` · status: declared · [`examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs:31`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs#L31)
> <a id="step-s6"></a>
> 6. **shop.oms** → **oms-pg** — by_id
>    status: declared · [`examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:26`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs#L26)
> <a id="step-s7"></a>
> 7. **shop.oms** → **oms-pg** — save
>    status: declared · [`examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:38`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs#L38)
> <a id="step-s8"></a>
> 8. **shop.oms** → **bus** — OrderConfirmed
>    [`shop.oms.order.OrderConfirmed`](../shop/oms/aggregates/order.md#event-shop-oms-order-orderconfirmed) · status: declared · [`examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs:38`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/confirm_order/mod.rs#L38)
>
> *self.request.handle(&event.order_id).await? is Some((Authorization::Declined(reason), _))*
>
> <a id="step-s9"></a>
> 9. **shop.oms** ↺ **shop.oms** — CancelOrder
>    `shop.oms.order/CancelOrder` · status: declared · [`examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs:43`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/policy/request_payment_on_order_placed.rs#L43)
> <a id="step-s10"></a>
> 10. **shop.oms** → **oms-pg** — by_id
>    status: declared · [`examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:35`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs#L35)
>
> > **One of**
> >
> > *order.status is Status::Cancelled — *ends the flow**
> >
> >
> > *otherwise*
> >
> > <a id="step-s11"></a>
> > 11. **shop.oms** → **oms-pg** — save
> >    status: declared · [`examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs#L50)
> > <a id="step-s12"></a>
> > 12. **shop.oms** → **bus** — OrderCancelled
> >    [`shop.oms.order.OrderCancelled`](../shop/oms/aggregates/order.md#event-shop-oms-order-ordercancelled) · status: declared · [`examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs:50`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/cancel_order/mod.rs#L50)
>
>
> *self.request.handle(&event.order_id).await? is None*
>
>
> *otherwise*
