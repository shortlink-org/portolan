# shortlink-org/portolan-shop-order

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `buf.build/shortlink-org/portolan-shop-order`
- **Registry:** buf.build
- **Publisher:** [shop.oms](../shop/oms/README.md)
- **Commit:** `6ae5e6ade8a547a59553b3aae02a2335`
- **Digest:** `b5:98cb137b4f89cdc545fec4d960a0d2fa57bc89e3a91803e305d7e19e52a12260d97642a4df82c3f97887fea0c25c976db3df9754b0eb3e09f39ceecfa21f7d92`
- **Source:** [`examples/shop/oms/vendor/proto/shortlink-org/portolan-shop-order`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/vendor/proto/shortlink-org/portolan-shop-order)

## Packages

| Package |
| --- |
| `shop.v1` |

## Files

| File |
| --- |
| [`shop/v1/orders.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/shop/v1/orders.proto) |

## Used by

| Service | Access |
| --- | --- |
| [Order Management](../shop/oms/README.md) | publishes |

## Interfaces

### shop.v1.OrderService

- **Source:** [`examples/shop/oms/vendor/proto/shortlink-org/portolan-shop-order/shop/v1/orders.proto:14`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/vendor/proto/shortlink-org/portolan-shop-order/shop/v1/orders.proto#L14)
- **Module:** [buf.build/shortlink-org/portolan-shop-order](shortlink-org-portolan-shop-order.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `CancelOrder` | `CancelOrderRequest` | `CancelOrderResponse` | CancelOrder cancels an order that has not been dispatched yet. FAILED_PRECONDITION once it has: from then on the way back is a return, which is delivery's business, not this service's. Cancelling twice is not an error; the second call answers with the already cancelled order. |
| `GetOrder` | `GetOrderRequest` | `GetOrderResponse` | GetOrder answers with the order as it is now. NOT_FOUND for an id the service has never seen; a cancelled order is still found. |

<a id="message-cancelorderrequest"></a>
<details><summary>CancelOrderRequest</summary>

| Field | Type |
| --- | --- |
| `order_id` | `string` |

</details>

<a id="message-cancelorderresponse"></a>
<details><summary>CancelOrderResponse</summary>

| Field | Type |
| --- | --- |
| `order` | `Order` |

</details>

<a id="message-getorderrequest"></a>
<details><summary>GetOrderRequest</summary>

| Field | Type |
| --- | --- |
| `order_id` | `string` |

</details>

<a id="message-getorderresponse"></a>
<details><summary>GetOrderResponse</summary>

| Field | Type |
| --- | --- |
| `order` | `Order` |

</details>

<a id="message-line"></a>
<details><summary>Line</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `quantity` | `int32` |
| `unit_price` | `Money` |

</details>

<a id="message-money"></a>
<details><summary>Money</summary>

| Field | Type |
| --- | --- |
| `amount_minor` | `int64` |
| `currency` | `string` |

</details>

<a id="message-order"></a>
<details><summary>Order</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | — |
| `customer_id` | `string` | The customer auth vouched for at checkout. Opaque here, as everywhere. |
| `basket_id` | `string` | The basket this order was placed from, so a reader can walk back to it. |
| `status` | `OrderStatus` | — |
| `lines` | `[]Line` | — |
| `total` | `Money` | The quoted total, tax and promotions included. |
| `placed_at` | `Timestamp` | — |

</details>
