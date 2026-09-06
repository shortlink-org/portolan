# shortlink-org/portolan-shop-price-list

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `buf.build/shortlink-org/portolan-shop-price-list`
- **Registry:** buf.build
- **Publisher:** [shop.pricing](../shop/pricing/README.md)
- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/proto)

## Packages

| Package |
| --- |
| `shop.v1` |

## Files

| File |
| --- |
| [`shop/v1/price_lists.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/shop/v1/price_lists.proto) |

## Used by

| Service | Access |
| --- | --- |
| [Pricing](../shop/pricing/README.md) | publishes |

## Interfaces

### shop.v1.PriceLists

- **Source:** [`examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/proto/shop/v1/price_lists.proto:9`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/proto/shop/v1/price_lists.proto#L9)
- **Module:** [buf.build/shortlink-org/portolan-shop-price-list](shortlink-org-portolan-shop-price-list.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `ArchivePriceList` | `ArchivePriceListRequest` | `ArchivePriceListResponse` | Take a list out of use without losing it. |
| `ImportPriceList` | `ImportPriceListRequest` | `ImportPriceListResponse` | Take in a whole list. |
| `ListPriceLists` | `ListPriceListsRequest` | `ListPriceListsResponse` | Every list there is, archived ones included. |

<a id="message-archivepricelistrequest"></a>
<details><summary>ArchivePriceListRequest</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |

</details>

<a id="message-archivepricelistresponse"></a>
<details><summary>ArchivePriceListResponse</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |

</details>

<a id="message-importpricelistrequest"></a>
<details><summary>ImportPriceListRequest</summary>

| Field | Type |
| --- | --- |
| `name` | `string` |
| `currency` | `string` |
| `valid_from` | `string` |
| `rows` | `[]PriceRow` |

</details>

<a id="message-importpricelistresponse"></a>
<details><summary>ImportPriceListResponse</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |
| `rows` | `int32` |

</details>

<a id="message-listpricelistsrequest"></a>
<details><summary>ListPriceListsRequest</summary>


</details>

<a id="message-listpricelistsresponse"></a>
<details><summary>ListPriceListsResponse</summary>

| Field | Type |
| --- | --- |
| `lists` | `[]PriceListSummary` |

</details>

<a id="message-pricelistsummary"></a>
<details><summary>PriceListSummary</summary>

| Field | Type |
| --- | --- |
| `price_list_id` | `string` |
| `name` | `string` |
| `currency` | `string` |
| `rows` | `int32` |
| `archived` | `bool` |

</details>

<a id="message-pricerow"></a>
<details><summary>PriceRow</summary>

| Field | Type |
| --- | --- |
| `sku` | `string` |
| `amount_minor` | `int64` |

</details>
