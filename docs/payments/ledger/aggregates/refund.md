# Refund

*Generated from the portolan catalog · commit `13 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `payments.ledger.refund`
- **Service:** [Ledger](../README.md)
- **Root:** `Refund`

Money going back, against a payment that was captured.

## Entities

### Refund — aggregate root

Money going back, against a payment that was captured.

| Field | Type |
| --- | --- |
| `id` | `String` |
| `paymentId` | `String` |
| `orderId` | `String` |
| `amount` | `Money` |
| `reason` | `String` |
| `status` | `RefundStatus` |
| `settledAt` | `Instant` |

## Enums

### RefundStatus

A refund is asked for, and then it either goes back or it does not.

| Value |
| --- |
| `REQUESTED` |
| `ISSUED` |
| `REJECTED` |

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> REQUESTED
    REQUESTED --> ISSUED: issue · RefundIssued
    REQUESTED --> REJECTED: reject
    ISSUED --> [*]
    REJECTED --> [*]
```

| From | To | On | Emits | Source |
| --- | --- | --- | --- | --- |
| `REQUESTED` | `ISSUED` | `issue` | `RefundIssued` | [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/domain/refund/Refund.java:57`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/domain/refund/Refund.java#L57) |
| `REQUESTED` | `REJECTED` | `reject` | — | [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/domain/refund/Refund.java:65`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/domain/refund/Refund.java#L65) |

## Operations

| Operation | Kind | Exposed by | Doc |
| --- | --- | --- | --- |
| `IssueRefund` | command | `IssueRefund` | Sends money back against a captured payment, in full or in part. |
| `ListRefunds` | query | `ListRefunds` | Every refund against one payment, newest first. |

## Events

<a id="event-payments-ledger-refund-refundissued"></a>
### RefundIssued

`payments.ledger.refund.RefundIssued`

On the wire as `ledger.RefundIssued`, on `payments.ledger.refund`.

#### v1 — current

Money went back to the customer, against a payment that had been captured.

Source: [`examples/payments/ledger/src/main/java/org/portolan/payments/ledger/domain/refund/event/RefundIssued.java`](https://github.com/shortlink-org/portolan/blob/main/examples/payments/ledger/src/main/java/org/portolan/payments/ledger/domain/refund/event/RefundIssued.java)

| Field | Type |
| --- | --- |
| `refundId` | `String` |
| `paymentId` | `String` |
| `orderId` | `String` |
| `amount` | `Money` |
| `reason` | `String` |
| `occurredAt` | `Instant` |
