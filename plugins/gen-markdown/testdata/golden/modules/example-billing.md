# Billing contracts

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `buf.build/example/billing`
- **Registry:** buf.build
- **Publisher:** [billing.invoices](../billing/invoices/README.md)
- **Commit:** `0123456789012345678901234567890123456789`
- **Digest:** `b5:example`
- **Source:** `api`

## Packages

| Package |
| --- |
| `billing.v1` |

## Files

| File |
| --- |
| `api/invoices.proto` |

## Used by

| Service | Access |
| --- | --- |
| [Invoices](../billing/invoices/README.md) | publishes |

## Interfaces

### billing.v1.Invoices

- **Source:** `api/invoices.proto`
- **Module:** [buf.build/example/billing](example-billing.md)

| Method | Route | Request | Response | Mode | Doc |
| --- | --- | --- | --- | --- | --- |
| `Get` | `GET /v1/invoices/{id}` | — | `Invoice` | deprecated | — |
| `Raise` | — | `RaiseRequest` | `Invoice` | server | Raises and follows one invoice. |

<a id="message-raiserequest"></a>
<details><summary>RaiseRequest</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `total` | [`Money`](../types.md#type-money) | What is owed. |

</details>

<a id="enum-kind"></a>
<details><summary>Kind (enum)</summary>

What the invoice is for.

| Value | Number | Doc |
| --- | --- | --- |
| `KIND_UNSPECIFIED` | 0 | — |
| `KIND_ORDER` | 1 | An order's goods. |

</details>
