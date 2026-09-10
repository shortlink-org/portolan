# PSP gateway

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `psp-gateway`
- **Where:** outside the estate
- **Documented at:** <https://psp.example/docs>

The card network the invoices are settled through. Nobody here builds it; the copy of its document vendored beside the client is all the catalog may claim.

## Provides

### psp.v1.Charges

- **Source:** `internal/psp/openapi/openapi.yaml`

| Method | Route | Request | Response |
| --- | --- | --- | --- |
| `Create` | `POST /v1/charges` | `CreateChargeRequest` | `Charge` |

<a id="message-charge"></a>
<details><summary>Charge</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | The charge, as the gateway names it. |
| `amount` | `integer` | Minor units. |

</details>

## Called by

| Service | Call | Status | Source | Via |
| --- | --- | --- | --- | --- |
| [Invoices](../billing/invoices/README.md) | `psp.v1.Charges/Create` | declared | `internal/psp/client.go:20` | [`flow.raise-invoice#s3`](../flows/raise-invoice.md#step-s3) |
