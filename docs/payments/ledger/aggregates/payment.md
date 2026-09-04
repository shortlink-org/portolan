# Payment

*Generated from the portolan catalog · commit `4 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `payments.ledger.payment`
- **Service:** [Ledger](../README.md)
- **Root:** `Payment`

One authorisation and the captures made against it.

## Postings

Every state change writes a balanced pair of postings. Nothing is updated in
place; a correction is a new pair with the opposite sign.

| Transition   | Debit        | Credit       |
| ------------ | ------------ | ------------ |
| authorise    | (none)       | (none)       |
| capture      | `merchant`   | `customer`   |
| fee          | `fees`       | `merchant`   |
| decline      | (none)       | (none)       |

Authorisations and declines write no postings: no money has moved.

## Currency

The customer is charged in the currency they were quoted in. When that is not
the currency the acquirer settles in, the rate is taken from the acquirer at
authorisation and stored on the payment — the posting has to be reproducible
years later, and a rate re-fetched then would be a different number. A
currency with no acquirer behind it is a `currency_unsupported` decline, not a
conversion.

## Failure

| Outcome    | Postings | Retryable                        |
| ---------- | -------- | -------------------------------- |
| `soft`     | none     | yes, on another instrument       |
| `hard`     | none     | no                               |
| `system`   | none     | yes, same instrument, with backoff |
| `timeout`  | none yet | the webhook decides, not us      |

A timeout is the only outcome that is not yet an outcome: the charge may well
have succeeded at the gateway, and until the webhook arrives nothing here may
assume either way.

## Commands

`Authorize`, `Capture` and `Decline` are all idempotent on
`idempotency_key`, which is retained for 30 days.

## Queries

`GetPayment` returns the payment and its full posting history.

## Entities

### Payment — aggregate root

One attempt to take money for an order, from authorization through to capture or decline.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Payment id. |
| `orderId` | `string` | Order being paid for. |
| `amount` | [`Money`](../../../types.md#money) | Amount authorized. |
| `state` | `string` | authorized \| captured \| declined \| voided \| settled. `voided` is a cancellation before capture and costs nothing; `declined` is a refusal. |
| `card` | `CardRef` | Instrument used, tokenized. |
| `settlement` | [`Money`](../../../types.md#money) | What the acquirer will actually settle, after any conversion. Equal to `amount` whenever the two currencies match. |
| `fx` | [`FxRate`](../../../types.md#fxrate) | The rate that produced `settlement`. Absent when no conversion happened, which is the common case. |
| `attempts` | `[]CaptureAttempt` | Every capture attempt, in order. The retry loop appends; nothing is ever overwritten. |
| `gateway` | [`GatewayRef`](../../../types.md#gatewayref) | The charge as the gateway knows it. |

### CaptureAttempt

One try at settling an authorization. Has identity inside the payment because the attempt number is what makes a retry safe.

| Field | Type | Doc |
| --- | --- | --- |
| `attempt` | `int32` | 1-based. Together with the order id this is the key ADR payments.0004 makes the journal idempotent on. |
| `requestedAt` | `time.Time` | When the attempt left for the gateway, not when it came back. |
| `outcome` | `string` | pending \| captured \| declined \| timeout. A `timeout` is not a failure: only the gateway's webhook can say which it was. |
| `gateway` | [`GatewayRef`](../../../types.md#gatewayref) | The gateway's ids for this attempt. A retry gets a new event id and keeps the charge id. |

## Value objects

### Money

An amount in a single currency.

Shared type [`Money`](../../../types.md#money).

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code, upper case. |

### CardRef

A tokenized instrument. Never holds a PAN; the token is the identity as far as the ledger is concerned.

| Field | Type | Doc |
| --- | --- | --- |
| `brand` | `string` | visa \| mastercard \| amex. |
| `last4` | `string` | Last four digits, for display only. |
| `token` | `string` | Vault token; the only thing the ledger stores. |

### GatewayRef

How the gateway refers to a charge. Ours to store, never ours to mint.

Shared type [`GatewayRef`](../../../types.md#gatewayref).

| Field | Type | Doc |
| --- | --- | --- |
| `provider` | `string` | Which gateway owns the id. Only `psp` today; the column exists because a second acquirer is already scheduled. |
| `chargeId` | `string` | The gateway's own id for the charge. The one handle that survives a restore of our database. |
| `eventId` | `string` | Id of the webhook event that last touched this charge. This is what the dedup table is keyed on. |

### FxRate

The rate applied when the customer's currency is not the one we settle in.

Shared type [`FxRate`](../../../types.md#fxrate).

| Field | Type | Doc |
| --- | --- | --- |
| `base` | `string` | ISO 4217 code the rate converts from — the currency the customer was quoted in. |
| `quote` | `string` | ISO 4217 code the rate converts to — the currency the acquirer settles in. |
| `rateMicros` | `int64` | Rate scaled by 1e6. An integer on purpose: a float rate cannot be reproduced exactly from a stored posting. |
| `quotedAt` | `time.Time` | When the rate was taken. A rate older than 60 seconds is refused rather than used. |
| `source` | `string` | `acquirer` for anything that moves money, `ecb-daily` for reporting only. The two disagree by a spread and must never be mixed. |

### DeclineReason

Why a payment was refused, in enough detail to decide whether trying again is worth anything.

| Field | Type | Doc |
| --- | --- | --- |
| `code` | `string` | The gateway's code, verbatim: `insufficient_funds`, `do_not_honor`, `currency_unsupported`, `expired_card`. |
| `category` | `string` | soft \| hard \| system. `soft` may be retried on another instrument, `hard` may not, `system` is ours to fix. |
| `retryable` | `bool` | Derived from the category, stored anyway so a consumer does not have to know the mapping. |
| `gatewayMessage` | `string` | The gateway's own words. Kept for support and never shown to a customer. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `Authorize` | command | Reserves funds at the gateway and fixes the settlement currency. Idempotent on the caller's key for 30 days: a repeat returns the first answer instead of reserving twice. |
| `Capture` | command | Settles a held authorization, wholly or in part. Appends a CaptureAttempt and posts the journal pair; the attempt number is what makes a retry safe. |
| `Decline` | command | Records a refusal, the gateway's or ours, with its code and category. Writes no postings — no money moved. |
| `GetPayment` | query | The payment with its capture attempts, its FX rate if there was one, and the full posting history. |

## Events

### PaymentAuthorized

`payments.ledger.payment.PaymentAuthorized`

| Consumer | Status | Note |
| --- | --- | --- |
| [shop.oms](../../../shop/oms/README.md) | verified | — |
| [delivery.core](../../../delivery/core/README.md) | declared | Used only to pre-warm route planning. |

#### v1 — current

Funds reserved with the PSP. No money has moved yet.

Source: `internal/ledger/domain/payment/events.go:44`

| Field | Type | Doc |
| --- | --- | --- |
| `paymentId` | `string` | Ledger identifier for this payment. |
| `orderId` | `string` | Order the authorisation belongs to. |
| `amount` | [`Money`](../../../types.md#money) | Amount reserved. |
| `authCode` | `string` | Opaque PSP authorisation code. |
| `expiresAt` | `time.Time` | Authorisations lapse after seven days. |

### PaymentCaptured

`payments.ledger.payment.PaymentCaptured`

| Consumer | Status |
| --- | --- |
| [delivery.core](../../../delivery/core/README.md) | verified |
| [shop.oms](../../../shop/oms/README.md) | verified |

#### v1 — current

Reserved funds settled. This is the event fulfilment reacts to.

Source: `internal/ledger/domain/payment/events.go:88`

| Field | Type | Doc |
| --- | --- | --- |
| `paymentId` | `string` | Ledger identifier for this payment. |
| `orderId` | `string` | Order the capture belongs to. |
| `amount` | [`Money`](../../../types.md#money) | Amount actually captured; may be less than authorised. |
| `capturedAt` | `time.Time` | Instant the PSP confirmed settlement. |

### PaymentDeclined

`payments.ledger.payment.PaymentDeclined`

| Consumer | Status |
| --- | --- |
| [shop.oms](../../../shop/oms/README.md) | verified |

#### v1 — current

The PSP refused the authorisation or the capture.

Source: `internal/ledger/domain/payment/events.go:126`

| Field | Type | Doc |
| --- | --- | --- |
| `paymentId` | `string` | Ledger identifier for the attempted payment. |
| `orderId` | `string` | Order that failed to pay. |
| `code` | `string` | Normalised decline code, not the raw PSP string. |
| `retryable` | `bool` | Whether another attempt is worth making. |
