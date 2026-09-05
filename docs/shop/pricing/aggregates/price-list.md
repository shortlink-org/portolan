# Price List

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `shop.pricing.price-list`
- **Service:** [Pricing](../README.md)
- **Root:** `PriceList`

What things cost before anybody asks.

A list is imported whole and never edited: a change is another list, valid from
its own moment, and the old one is archived rather than deleted so that a quote
priced against it stays readable. Nothing here is announced on the bus - a
price list changing is this service's business until somebody asks for a quote.

## Entities

### PriceList — aggregate root

PriceList is one import of prices, valid from a moment. Lists are never edited: a change is a new list, and what a quote was priced against stays readable for as long as the quote does.

| Field | Type |
| --- | --- |
| `id` | `string` |
| `name` | `string` |
| `currency` | `string` |
| `rows` | `[]Row` |
| `validFrom` | `time.Time` |
| `archived` | `bool` |

### Row

Row is one price in a list. An entity rather than a value: it is tracked over the life of the list, and a reader asks about this sku's price in that list.

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `price` | `money.Money` |

## Operations

| Operation | Kind | Exposed by | Doc |
| --- | --- | --- | --- |
| `ArchivePriceList` | command | `ArchivePriceList` | Package archive_price_list takes a price list out of use without losing it. |
| `ImportPriceList` | command | `ImportPriceList` | Package import_price_list takes in a whole price list. |
| `ListPriceLists` | query | `ListPriceLists` | Package list_price_lists reads every price list there is. |
