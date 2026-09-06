# shortlink-org/portolan-payments-payment

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `buf.build/shortlink-org/portolan-payments-payment`
- **Registry:** buf.build
- **Publisher:** [payments.ledger](../payments/ledger/README.md)
- **Source:** [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/proto`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/proto)

## Packages

| Package |
| --- |
| `payments.v1` |

## Files

| File |
| --- |
| [`payments/v1/payment.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/payments/v1/payment.proto) |

## Used by

| Service | Access |
| --- | --- |
| [Ledger](../payments/ledger/README.md) | publishes |

## Interfaces

### payments.v1.PaymentService

- **Source:** [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/proto/payments/v1/payment.proto:12`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/proto/payments/v1/payment.proto#L12)
- **Module:** [buf.build/shortlink-org/portolan-payments-payment](shortlink-org-portolan-payments-payment.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `Authorize` | `AuthorizeRequest` | `AuthorizeResponse` | Ask the gateway to hold the money for an order. |
| `Capture` | `CaptureRequest` | `CaptureResponse` | Move what is being held. Only an authorized payment can be captured. |
| `GetPayment` | `GetPaymentRequest` | `GetPaymentResponse` | What happened to the money for one payment. |

<a id="message-authorizerequest"></a>
<details><summary>AuthorizeRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |
| `order_id` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |

</details>

<a id="message-authorizeresponse"></a>
<details><summary>AuthorizeResponse</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `payment_id` | `string` | — |
| `authorized` | `bool` | — |
| `reason` | `string` | Why not, when not: a name from the ledger's closed set (CARD_REFUSED, ORDER_CANCELLED). Empty when authorized. |

</details>

<a id="message-capturerequest"></a>
<details><summary>CaptureRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |

</details>

<a id="message-captureresponse"></a>
<details><summary>CaptureResponse</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |
| `captured_at` | `string` |

</details>

<a id="message-getpaymentrequest"></a>
<details><summary>GetPaymentRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |

</details>

<a id="message-getpaymentresponse"></a>
<details><summary>GetPaymentResponse</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |
| `order_id` | `string` |
| `status` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |

</details>
