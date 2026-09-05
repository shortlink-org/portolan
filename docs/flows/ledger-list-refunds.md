# List refunds

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.ledger-list-refunds`
- **Owner:** [payments](../payments/README.md)
- **Source:** `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/refund/RefundGrpcService.java`

Every refund against one payment, newest first.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `payments.ledger` | service | [payments](../payments/README.md) |
| `ledger-pg` | store | [payments](../payments/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as payments.ledger
    participant p2 as ledger-pg
    p0->>p1: ListRefunds → ListRefundsResponse
    p1->>p2: byPayment
```

## Steps

1. **client** → **payments.ledger** — ListRefunds → ListRefundsResponse
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/refund/RefundGrpcService.java:44`
2. **payments.ledger** → **ledger-pg** — byPayment
   status: declared · `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/application/refund/usecase/ListRefunds.java:27`
