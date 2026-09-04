# Quote

*Generated from the portolan catalog · commit `3 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.pricing.quote`
- **Service:** [Pricing](../README.md)
- **Root:** `Quote`

An immutable, time-boxed price for one basket and one customer.

## Currency

Quoting never converts. The customer's currency selects the price list, and a
currency no active list covers is a refusal — an FX rate belongs to the
moment money moves, not to the moment a price is shown.

## Why immutable

A quote is a promise. Re-deriving it later would give a different answer once
price lists change, which makes disputes unwinnable. So the quote is stored
whole, including which price list won and which promotions applied.

## Commands

| Command      | Notes                                       |
| ------------ | ------------------------------------------- |
| `IssueQuote` | Computes precedence and applies promotions  |
| `ExpireQuote`| Called by the sweeper, never by a customer  |

## Queries

`GetQuote` returns the stored quote verbatim, including expired ones, so
support can explain what a customer was shown.

## Entities

### Quote — aggregate root

A price offered for a basket, valid until it expires.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Quote id. |
| `basketId` | `string` | Basket the quote was calculated for. |
| `lines` | `[]QuotedLine` | Per-SKU pricing. |
| `total` | [`Money`](../../../types.md#money) | Quoted total. |
| `expiresAt` | `time.Time` | After this, the quote is void. |
| `currency` | `string` | ISO 4217, taken from the price list that won. A basket in a currency no active list covers is refused, not converted. |
| `priceListId` | `string` | Which list produced these prices. Stored so a disputed quote can be re-read against the list as it was. |

## Value objects

### Money

An amount in a single currency.

Shared type [`Money`](../../../types.md#money).

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code, upper case. |

### QuotedLine

The price arrived at for one SKU, with the discount that produced it. Local to pricing; nothing outside quotes uses this shape.

| Field | Type | Doc |
| --- | --- | --- |
| `sku` | `string` | SKU priced. |
| `unitPrice` | [`Money`](../../../types.md#money) | Price per unit after discount. |
| `discountMinor` | `int64` | Discount applied, in the minor unit. |
| `rule` | `string` | Id of the pricing rule that fired. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `IssueQuote` | command | Prices a basket against the list matching the customer's segment and currency. A basket in a currency no active list covers is refused rather than converted. |
| `ExpireQuote` | command | Marks a quote past its validity. Runs on a sweep rather than on read, so an expired quote is briefly still readable. |
| `GetQuote` | query | One quote, whole: the lines, which price list won, and which rule produced each discount. |

## Events

### QuoteIssued

`shop.pricing.quote.QuoteIssued`

| Consumer | Status |
| --- | --- |
| [shop.oms](../../oms/README.md) | verified |

#### v1 — current

A priced, time-boxed answer for one basket and one customer.

Source: `internal/pricing/domain/quote/events.go:27`

| Field | Type | Doc |
| --- | --- | --- |
| `quoteId` | `string` | Identifier of the issued quote. |
| `basketId` | `string` | Basket the quote was computed for. |
| `total` | [`Money`](../../../types.md#money) | Quoted total including promotions. |
| `priceListId` | `string` | Price list that won precedence. |
| `expiresAt` | `time.Time` | After this instant the quote must not be used. |

### QuoteExpired

`shop.pricing.quote.QuoteExpired`

| Consumer | Status | Note |
| --- | --- | --- |
| [shop.oms](../../oms/README.md) | declared | Handler exists but is registered behind a disabled feature flag. |

#### v1 — current

A quote passed its expiry without being consumed.

Source: `internal/pricing/domain/quote/events.go:61`

| Field | Type | Doc |
| --- | --- | --- |
| `quoteId` | `string` | Quote that expired. |
| `expiredAt` | `time.Time` | Instant the sweeper observed the expiry. |
