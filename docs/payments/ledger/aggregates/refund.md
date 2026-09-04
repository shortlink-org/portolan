# Refund

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `payments.ledger.refund`
- **Service:** [Ledger](../README.md)
- **Root:** `Refund`

A compensating movement against a captured payment.

## Rules

- The sum of refunds against a payment may never exceed the captured amount.
- A refund against an uncaptured payment is a void, handled by `Payment`, not
  here.
- Partial refunds are unlimited in count but each needs a distinct reason.

## Settling

A refund is not done when it is issued. It leaves here in `pending` and the
gateway confirms it by webhook, usually in hours and sometimes in days. The
hourly poll exists because that webhook is not guaranteed. A refund the
gateway rejects is stored with its reason and published nowhere — the one
outcome in this aggregate that no consumer can see.

## Commands

| Command        | Precondition                    |
| -------------- | ------------------------------- |
| `IssueRefund`  | Payment captured, headroom left |

## Queries

`ListRefunds` returns refunds for one payment, newest first.

## Entities

### Refund — aggregate root

Money returned against a captured payment.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Refund id. |
| `paymentId` | `string` | Payment being refunded. |
| `amount` | [`Money`](../../../types.md#money) | Amount returned; never exceeds the capture. |
| `reason` | `string` | Free text, taken from the support tool. |
| `state` | `string` | requested \| pending \| settled \| rejected. `pending` belongs to the gateway, not to us, and it can sit there for days. |
| `settlement` | `Settlement` | Where the gateway has got to with it. |
| `gateway` | [`GatewayRef`](../../../types.md#gatewayref) | The charge the refund is written against. |

## Value objects

### Money

An amount in a single currency.

Shared type [`Money`](../../../types.md#money).

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code, upper case. |

### Settlement

The gateway's progress on a refund. Ours to record, not to decide.

| Field | Type | Doc |
| --- | --- | --- |
| `state` | `string` | pending \| settled \| rejected, as last reported. |
| `requestedAt` | `time.Time` | When the refund was sent to the gateway. |
| `settledAt` | `time.Time` | When the gateway confirmed. Absent while pending, and absent forever if rejected. |
| `polls` | `int32` | How many times we asked. The poll is the fallback for a webhook that never came. |

### GatewayRef

The same shared reference the payment carries — a refund is written against the gateway's charge, not against ours.

Shared type [`GatewayRef`](../../../types.md#gatewayref).

| Field | Type | Doc |
| --- | --- | --- |
| `provider` | `string` | Which gateway owns the id. Only `psp` today; the column exists because a second acquirer is already scheduled. |
| `chargeId` | `string` | The gateway's own id for the charge. The one handle that survives a restore of our database. |
| `eventId` | `string` | Id of the webhook event that last touched this charge. This is what the dedup table is keyed on. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `IssueRefund` | command | Returns money against a captured payment, up to the headroom left on it. Lands in `pending` and stays there until the gateway settles or refuses it. |
| `ListRefunds` | query | Refunds against one payment, newest first, including the ones the gateway rejected. |

## Events

### RefundIssued

`payments.ledger.refund.RefundIssued`

| Consumer | Status |
| --- | --- |
| [delivery.core](../../../delivery/core/README.md) | declared |

#### v1 — current

A compensating posting pair against a captured payment.

Source: `internal/ledger/domain/refund/events.go:30`

| Field | Type | Doc |
| --- | --- | --- |
| `refundId` | `string` | Identifier of the refund. |
| `paymentId` | `string` | Payment being refunded. |
| `amount` | [`Money`](../../../types.md#money) | Amount refunded; may be partial. |
| `reason` | `string` | Free text, surfaced to support tooling. |
