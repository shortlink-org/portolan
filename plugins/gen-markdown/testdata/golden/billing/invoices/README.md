# Invoices

*Generated from the portolan catalog · commit `abc1234` · at 2026-01-02T03:04:05Z. Do not edit by hand.*

- **Id:** `billing.invoices`
- **Context:** [Billing](../README.md)
- **Repo:** `github.com/example/billing`
- **Path:** `services/invoices`

Raises invoices and chases them.

## Not here

No dunning.

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Invoice](aggregates/invoice.md) | `Invoice` | 1 command | 1 query | 1 event |

## Provides

**`billing.v1.Invoices`** — `api/invoices.proto`

- `Raise`
- `Get`

<details><summary>RaiseRequest</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `total` | [`Money`](../../types.md#money) | What is owed. |

</details>

## Consumes

| Call | Peer | Status | Source | Note |
| --- | --- | --- | --- | --- |
| `psp.v1.Charges/Create` | [psp-gateway](../../externals/psp-gateway.md) | declared | `internal/psp/client.go:20` | The gateway is outside the estate; the copy beside the client says what it answers on. |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [InvoiceRaised](aggregates/invoice.md) | v2 | `billing.ledger (declared)` |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Invoices Postgres](stores/pg.md) | postgres | owns | 2 tables |
