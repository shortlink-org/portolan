# PriceList

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.pricing.price-list`
- **Service:** [Pricing](../README.md)
- **Root:** `PriceList`

The set of prices that quoting reads from. Contract, regional and public lists
share this aggregate and differ only by scope.

## No events

This aggregate publishes no domain events. Price lists are edited through an
internal admin tool that writes to the store directly, bypassing the domain
layer entirely.

That is a gap, not a decision. Anything that wants to react to a price change
currently polls. Emitting `PriceListPublished` is tracked as work, and until it
exists this page will keep showing an empty event list.

## Commands

| Command             | Notes                                    |
| ------------------- | ---------------------------------------- |
| `ImportPriceList`   | Bulk CSV import, validated then swapped  |
| `ArchivePriceList`  | Soft delete; quoting stops selecting it  |

## Queries

`ListPriceLists` is the only read path and is heavily cached.

## Entities

### PriceList — aggregate root

A dated set of prices, imported wholesale from the merchandising system.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Price list id. |
| `name` | `string` | Human name, as given by merchandising. |
| `validFrom` | `time.Time` | First day the list applies. |
| `rows` | `[]PriceRow` | One row per SKU. |
| `currency` | `string` | ISO 4217. A list prices in exactly one currency; a second currency is a second list, not a conversion. |

### PriceRow

One SKU's price inside a list. Identified by SKU within its list.

| Field | Type | Doc |
| --- | --- | --- |
| `sku` | `string` | SKU priced. |
| `price` | [`Money`](../../../types.md#money) | List price, net of tax. |

## Value objects

### Money

An amount in a single currency.

Shared type [`Money`](../../../types.md#money).

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code, upper case. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `ImportPriceList` | command | Replaces a list wholesale from the merchandising export. A partial import is rejected outright — half a price list is worse than a stale one. |
| `ArchivePriceList` | command | Takes a list out of quoting without deleting it. Quotes already issued from it stay valid until they expire. |
| `ListPriceLists` | query | Active lists with their currency and validity window. The only pricing query the storefront may reach directly. |
