# Ledger

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `payments.ledger`
- **Context:** [Payments](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/payments/ledger`

Service `ledger` — bounded context **payments**. Java on Spring Boot.

Owns money. Every authorisation, capture and refund against an order passes
through here, and what it writes is the record the business is audited on.
Nothing it holds is updated in place: a movement of money is a pair of postings
that sum to zero, and a correction is another pair.

## What it does

- Asks the gateway to hold the money for an order, and records either the hold
  or the refusal — `PaymentAuthorized` or `PaymentDeclined`.
- Captures what was held, writes the pair of postings for it, and says
  `PaymentCaptured`. That is the message anything waiting to be paid listens for.
- Sends money back against a captured payment, in full or in part, and says
  `RefundIssued`.
- Gives back a hold nobody will be charged for, when the order it was held for
  is cancelled.

## What it does not do

Does not decide *whether* to charge — that is the order's business, and the
ledger is asked. Does not issue invoices: what a customer is *asked* to pay is
`shop.billing`'s aggregate, and this one only says what happened to the money.
Does not store card data; the gateway holds the instrument and this holds a
token for it.

## Publishes

`PaymentAuthorized`, `PaymentCaptured`, `PaymentDeclined` on
`payments.ledger.payment`; `RefundIssued` on `payments.ledger.refund`.

## Provides

`payments.v1.PaymentService` — Authorize, Capture, GetPayment — and
`payments.v1.RefundService` — IssueRefund, ListRefunds. One contract per
aggregate, under the transport package that answers it, each its own buf
module with its own `buf.yaml`.

Both are published: `buf.build/shortlink-org/portolan-payments-payment` and
`buf.build/shortlink-org/portolan-payments-refund`, one module per aggregate.
A change to either is pushed from its own directory, and the estate reads the
module name off `portolan.json`:

```bash
cd src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/proto && buf push
cd ../../refund/proto && buf push
```

## How the catalog reads it

Nothing here is annotated for the catalog, but plenty is annotated for the
model: `@AggregateRoot`, `@Entity`, `@ValueObject`, `@Repository`,
`@SecondaryPort` and `@DomainEvent` are jMolecules, and `extract-java` reads
what they say rather than guessing from the layout. The rules are in
[plugins/extract-java/README.md](../../../plugins/extract-java/README.md).

Two things follow from that and are worth knowing when reading the pages:

- A `@Repository` is the store, and any other port goes wherever its adapter
  reaches. `PaymentGateway` is filled by `PspGateway`, which has no vendored
  contract because the far end is a third party — so those calls are recorded
  and left **unresolved**, which is the true answer to "who answers this".
- The lifecycle is `PaymentStatus.TRANSITIONS`, not the branches of the methods.
  A move the table does not allow is a diagnostic, not a new arrow.

## Running it

```bash
docker compose up -d db
mvn -q spring-boot:run
```

`NATS_URL` picks the bus: with a server named, events leave on their channel
with their wire name in the headers; without one they are written to the log and
nothing leaves. `OMS_ADDRESS` is where `shop.v1.OrderService` answers.

## Decisions

- [payments.0004](../../../docs/adr/payments.0004.md) — journal rows are
  idempotent by `(order_id, attempt)`, which is why `payments` carries an
  `attempt` and a unique key over the pair.

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Payment](aggregates/payment.md) | `Payment` | 2 commands | 1 query | 3 events |
| [Refund](aggregates/refund.md) | `Refund` | 1 command | 1 query | 1 event |

## Provides

**`payments.v1.PaymentService`** — `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/proto/payments/v1/payment.proto:12`

- `Authorize`
- `Capture`
- `GetPayment`

<details><summary>AuthorizeRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |
| `order_id` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |

</details>

<details><summary>AuthorizeResponse</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |
| `auth_code` | `string` |
| `authorized` | `bool` |

</details>

<details><summary>CaptureRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |

</details>

<details><summary>CaptureResponse</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |
| `captured_at` | `string` |

</details>

<details><summary>GetPaymentRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |

</details>

<details><summary>GetPaymentResponse</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |
| `order_id` | `string` |
| `status` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |

</details>

**`payments.v1.RefundService`** — `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/refund/proto/payments/v1/refund.proto:10`

- `IssueRefund`
- `ListRefunds`

<details><summary>IssueRefundRequest</summary>

| Field | Type |
| --- | --- |
| `refund_id` | `string` |
| `payment_id` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |
| `reason` | `string` |

</details>

<details><summary>IssueRefundResponse</summary>

| Field | Type |
| --- | --- |
| `refund_id` | `string` |
| `issued` | `bool` |

</details>

<details><summary>ListRefundsRequest</summary>

| Field | Type |
| --- | --- |
| `payment_id` | `string` |

</details>

<details><summary>ListRefundsResponse</summary>

| Field | Type |
| --- | --- |
| `refunds` | `[]RefundView` |

</details>

<details><summary>RefundView</summary>

| Field | Type |
| --- | --- |
| `refund_id` | `string` |
| `amount_minor` | `int64` |
| `currency` | `string` |
| `status` | `string` |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `psp/giveBack` | `psp` | unresolved | `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/psp/PspGateway.java` |
| `psp/release` | `psp` | unresolved | `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/psp/PspGateway.java` |
| `psp/reserve` | `psp` | unresolved | `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/psp/PspGateway.java` |
| `psp/settle` | `psp` | unresolved | `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/psp/PspGateway.java` |
| `shop.v1.OrderService/GetOrder` | [shop.oms](../../shop/oms/README.md) | declared | `examples/payments/ledger/src/main/java/org/portolan/payments/ledger/infrastructure/oms/proto/shop/v1/order.proto` |

## Publishes

| Event | Latest | Consumers |
| --- | --- | --- |
| [PaymentAuthorized](aggregates/payment.md) | v1 | [shop.oms (declared)](../../shop/oms/README.md) |
| [PaymentCaptured](aggregates/payment.md) | v1 | [shop.billing (declared)](../../shop/billing/README.md), [delivery.core (declared)](../../delivery/core/README.md) |
| [PaymentDeclined](aggregates/payment.md) | v1 | [shop.oms (declared)](../../shop/oms/README.md) |
| [RefundIssued](aggregates/refund.md) | v1 | — |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Ledger database](stores/pg.md) | postgres | owns | 3 tables |
