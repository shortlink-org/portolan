# Order

*Generated from the portolan catalog · commit `4 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.oms.order`
- **Service:** [Order Management](../README.md)
- **Root:** `Order`

The transactional boundary for a single customer order. One order, one
aggregate instance, one row lock.

## Invariants

- An order always has at least one line item.
- The total is recomputed from line items on every mutation; it is never set
  directly by a caller.
- A cancelled order is terminal. There is no un-cancel.
- Every line, and the total, is in the order's own currency. Mixing two
  currencies in one order is refused at placement; nothing converts.
- An order carries the risk decision that let it through, including a
  `review` decision reached only because the scorer timed out.

## Commands

| Command        | Precondition            | Emits            |
| -------------- | ----------------------- | ---------------- |
| `PlaceOrder`   | quote is unexpired      | `OrderPlaced`    |
| `ConfirmOrder` | payment captured        | `OrderConfirmed` |
| `CancelOrder`  | not already fulfilled   | `OrderCancelled` |

## Queries

`GetOrder` and `ListOrdersForCustomer` are served from a read replica and are
eventually consistent with the write side.

## Concurrency

Optimistic, on a `version` column. A conflicting write returns
`ErrConcurrentModification` and the caller is expected to reload and retry.

## Entities

### Order — aggregate root

The order itself. Identity is the order id, which is minted at placement and never reused.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Order id, minted at placement. |
| `status` | `string` | placed \| awaiting-review \| confirmed \| cancelled. `awaiting-review` is where a fail-open risk check leaves the order: accepted, but not yet trusted. |
| `customer` | [`CustomerRef`](../../../types.md#customerref) | Who placed it. |
| `lines` | `[]OrderLine` | One line per SKU ordered. |
| `total` | [`Money`](../../../types.md#money) | Order total, net of shipping. |
| `shipTo` | [`Address`](../../../types.md#address) | Delivery address as entered. |
| `currency` | `string` | Presentment currency, frozen at placement. Every Money on the order is in it; a basket that would mix two is refused rather than converted. |
| `risk` | `RiskDecision` | How the risk check answered — including the case where it did not answer at all. |

### OrderLine

A single ordered SKU. Has identity inside the order so a line can be amended without rewriting the rest.

| Field | Type | Doc |
| --- | --- | --- |
| `lineNo` | `int32` | Position in the order, 1-based. |
| `sku` | `string` | Catalog SKU at the time of ordering. |
| `quantity` | `int32` | Units ordered; always positive. |
| `unitPrice` | [`Money`](../../../types.md#money) | Price per unit, net of tax. |

## Value objects

### Money

An amount in a single currency. Equal amounts in the same currency are the same value.

Shared type [`Money`](../../../types.md#money).

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code, upper case. |

### Address

A postal address, unvalidated. Frozen onto the order at placement.

Shared type [`Address`](../../../types.md#address).

| Field | Type | Doc |
| --- | --- | --- |
| `line1` | `string` | Street and number. |
| `line2` | `string` | Optional second line. |
| `city` | `string` | City or locality. |
| `postcode` | `string` | Postal code, unvalidated. |
| `country` | `string` | ISO 3166-1 alpha-2. |

### CustomerRef

A pointer at the customer, plus the pricing segment as it stood when the order was taken.

Shared type [`CustomerRef`](../../../types.md#customerref).

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Stable customer identifier. |
| `segment` | `string` | Pricing segment at time of capture. |

### RiskDecision

What the scorer said about this order, and what was done when it said nothing.

| Field | Type | Doc |
| --- | --- | --- |
| `score` | `int32` | 0–100 as the model returned it. Absent when the decision was `review`. |
| `decision` | `string` | accept \| reject \| review. `review` is what a timed-out scorer produces, not an answer the model gave. |
| `decidedAt` | `time.Time` | When the decision was reached, which for `review` is when the deadline expired. |
| `source` | `string` | `fraud.v2.Scoring` when the model answered, `fail-open` when it did not. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `PlaceOrder` | command | Turns a checked-out basket into an order. Requires an unexpired quote and one currency across every line; writes the order and its OrderPlaced outbox row in the same transaction. |
| `ConfirmOrder` | command | Commits the order to fulfilment once the payment is authorized. Emits OrderConfirmed. Refuses an order still `awaiting-review`. |
| `CancelOrder` | command | Ends the order. Allowed only while the shipment is `held` or `planned`, and that state is read from delivery rather than assumed. Emits OrderCancelled. |
| `GetOrder` | query | One order with its lines and its risk decision. Served from a replica, so a read straight after a write can still show the previous status. |
| `ListOrdersForCustomer` | query | A customer's orders, newest first, paginated on the placement timestamp. Never joins payments — the caller resolves those itself. |

## Events

### OrderPlaced

`shop.oms.order.OrderPlaced`

| Consumer | Status | Note |
| --- | --- | --- |
| [payments.ledger](../../../payments/ledger/README.md) | verified | — |
| [shop.pricing](../../pricing/README.md) | declared | — |
| `analytics-sink` | unresolved | Seen on the bus in traces; no consumer registration found in any repo. |

#### v1

Emitted once a basket has been converted into an immutable order.

Source: `internal/oms/domain/order/events.go:41`

| Field | Type | Doc |
| --- | --- | --- |
| `orderId` | `string` | Identifier of the newly placed order. |
| `customer` | [`CustomerRef`](../../../types.md#customerref) | Who placed the order. |
| `items` | [`LineItem`](../../../types.md#lineitem) | Frozen basket contents. |
| `total` | [`Money`](../../../types.md#money) | Order total, net of shipping. |
| `shipTo` | [`Address`](../../../types.md#address) | Delivery address as entered by the customer. |
| `placedAt` | `time.Time` | Server time the order was accepted. |

#### v2 — current

Adds the acquisition channel so pricing and delivery can differ per channel.

Source: `internal/oms/domain/order/events.go:78`

| Field | Type | Doc |
| --- | --- | --- |
| `orderId` | `string` | Identifier of the newly placed order. |
| `customer` | [`CustomerRef`](../../../types.md#customerref) | Who placed the order. |
| `items` | [`LineItem`](../../../types.md#lineitem) | Frozen basket contents. |
| `total` | [`Money`](../../../types.md#money) | Order total, net of shipping. |
| `shipTo` | [`Address`](../../../types.md#address) | Delivery address as entered by the customer. |
| `placedAt` | `time.Time` | Server time the order was accepted. |
| `channel` | `string` | New in v2. One of web, ios, android, pos. |

### OrderConfirmed

`shop.oms.order.OrderConfirmed`

| Consumer | Status |
| --- | --- |
| [delivery.core](../../../delivery/core/README.md) | verified |

#### v1 — current

Payment captured and the order is committed to fulfilment.

Source: `internal/oms/domain/order/events.go:150`

| Field | Type | Doc |
| --- | --- | --- |
| `orderId` | `string` | Order that was confirmed. |
| `paymentId` | `string` | Ledger payment that backs this confirmation. |
| `confirmedAt` | `time.Time` | Server time of confirmation. |

### OrderCancelled

`shop.oms.order.OrderCancelled`

| Consumer | Status |
| --- | --- |
| [payments.ledger](../../../payments/ledger/README.md) | verified |
| [delivery.core](../../../delivery/core/README.md) | declared |

#### v1 — current

The order was cancelled before fulfilment, by the customer or by risk.

Source: `internal/oms/domain/order/events.go:112`

| Field | Type | Doc |
| --- | --- | --- |
| `orderId` | `string` | Order that was cancelled. |
| `reason` | `string` | One of customer_request, risk_rejected, payment_failed. |
| `refundDue` | [`Money`](../../../types.md#money) | Amount to be refunded, zero if nothing was captured. |
| `cancelledAt` | `time.Time` | Server time of cancellation. |
