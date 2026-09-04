# Shared types

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

Types named by more than one aggregate, event or message. A field that
refers to one of these is knowably the same shape everywhere it appears.

## Address

| Field | Type | Doc |
| --- | --- | --- |
| `line1` | `string` | Street and number. |
| `line2` | `string` | Optional second line. |
| `city` | `string` | City or locality. |
| `postcode` | `string` | Postal code, unvalidated. |
| `country` | `string` | ISO 3166-1 alpha-2. |

## CustomerRef

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Stable customer identifier. |
| `segment` | `string` | Pricing segment at time of capture. |

## FxRate

| Field | Type | Doc |
| --- | --- | --- |
| `base` | `string` | ISO 4217 code the rate converts from — the currency the customer was quoted in. |
| `quote` | `string` | ISO 4217 code the rate converts to — the currency the acquirer settles in. |
| `rateMicros` | `int64` | Rate scaled by 1e6. An integer on purpose: a float rate cannot be reproduced exactly from a stored posting. |
| `quotedAt` | `time.Time` | When the rate was taken. A rate older than 60 seconds is refused rather than used. |
| `source` | `string` | `acquirer` for anything that moves money, `ecb-daily` for reporting only. The two disagree by a spread and must never be mixed. |

## GatewayRef

| Field | Type | Doc |
| --- | --- | --- |
| `provider` | `string` | Which gateway owns the id. Only `psp` today; the column exists because a second acquirer is already scheduled. |
| `chargeId` | `string` | The gateway's own id for the charge. The one handle that survives a restore of our database. |
| `eventId` | `string` | Id of the webhook event that last touched this charge. This is what the dedup table is keyed on. |

## LineItem

| Field | Type | Doc |
| --- | --- | --- |
| `sku` | `string` | Catalog SKU at the time of ordering. |
| `quantity` | `int32` | Units ordered; always positive. |
| `unitPrice` | [`Money`](types.md#money) | Price per unit, net of tax. |

## Money

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code, upper case. |
