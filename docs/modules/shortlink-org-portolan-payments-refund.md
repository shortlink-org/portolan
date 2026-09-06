# shortlink-org/portolan-payments-refund

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `buf.build/shortlink-org/portolan-payments-refund`
- **Registry:** buf.build
- **Publisher:** [payments.ledger](../payments/ledger/README.md)
- **Source:** [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/refund/proto`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/refund/proto)

## Packages

| Package |
| --- |
| `payments.v1` |

## Files

| File |
| --- |
| [`payments/v1/refund.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/payments/v1/refund.proto) |

## Used by

| Service | Access |
| --- | --- |
| [Ledger](../payments/ledger/README.md) | publishes |

## Interfaces

### payments.v1.RefundService

- **Source:** [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/refund/proto/payments/v1/refund.proto:10`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/refund/proto/payments/v1/refund.proto#L10)
- **Module:** [buf.build/shortlink-org/portolan-payments-refund](shortlink-org-portolan-payments-refund.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `IssueRefund` | `IssueRefundRequest` | `IssueRefundResponse` | Send money back against a captured payment, in full or in part. |
| `ListRefunds` | `ListRefundsRequest` | `ListRefundsResponse` | Every refund against one payment. |

<a id="message-issuerefundrequest"></a>
<details><summary>IssueRefundRequest</summary>

| Field | Type |
| --- | --- |
| `refund_id` | `string` |
| `payment_id` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |
| `reason` | `string` |

</details>

<a id="message-issuerefundresponse"></a>
<details><summary>IssueRefundResponse</summary>

| Field | Type |
| --- | --- |
| `refund_id` | `string` |
| `issued` | `bool` |

</details>

<a id="message-listrefundsrequest"></a>
<details><summary>ListRefundsRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |

</details>

<a id="message-listrefundsresponse"></a>
<details><summary>ListRefundsResponse</summary>

| Field | Type |
| --- | --- |
| `refunds` | `[]RefundView` |

</details>

<a id="message-refundview"></a>
<details><summary>RefundView</summary>

| Field | Type |
| --- | --- |
| `refund_id` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |
| `status` | `string` |

</details>
