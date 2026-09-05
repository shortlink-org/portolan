# PSP gateway

*Generated from the portolan catalog · commit `abc1234` · at 2026-01-02T03:04:05Z. Do not edit by hand.*

- **Id:** `psp-gateway`
- **Where:** outside the estate
- **Documented at:** <https://psp.example/docs>

The card network the invoices are settled through. Nobody here builds it; the copy of its document vendored beside the client is all the catalog may claim.

## Provides

**`psp.v1.Charges`** — `internal/psp/openapi/openapi.yaml`

- `Create` — `POST /v1/charges`

<details><summary>Charge</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | The charge, as the gateway names it. |
| `amount` | `integer` | Minor units. |

</details>

## Called by

| Service | Call | Status | Source |
| --- | --- | --- | --- |
| [Invoices](../billing/invoices/README.md) | `psp.v1.Charges/Create` | declared | `internal/psp/client.go:20` |
