# shortlink-org/portolan-delivery-shipment

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `buf.build/shortlink-org/portolan-delivery-shipment`
- **Registry:** buf.build
- **Publisher:** [delivery.core](../delivery/core/README.md)
- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/proto)

## Packages

| Package |
| --- |
| `delivery.v1` |

## Files

| File |
| --- |
| [`delivery/v1/delivery.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/delivery/v1/delivery.proto) |

## Used by

| Service | Access |
| --- | --- |
| [Delivery Core](../delivery/core/README.md) | publishes |

## Interfaces

### delivery.v1.Delivery

- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/proto/delivery/v1/delivery.proto:9`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/proto/delivery/v1/delivery.proto#L9)
- **Module:** [buf.build/shortlink-org/portolan-delivery-shipment](shortlink-org-portolan-delivery-shipment.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `Dispatch` | `DispatchRequest` | `DispatchResponse` | Hand a planned shipment to the carrier. |
| `GetShipment` | `GetShipmentRequest` | `GetShipmentResponse` | One shipment, for whoever is asking about an order. |
| `RecordDelivery` | `RecordDeliveryRequest` | `RecordDeliveryResponse` | End a shipment at the door. |
| `RecordScan` | `RecordScanRequest` | `RecordScanResponse` | Write down that a parcel was seen somewhere. |
| `TrackShipment` | `TrackShipmentRequest` | `TrackShipmentResponse` | What the customer sees when they paste a tracking code. |

<a id="message-dispatchrequest"></a>
<details><summary>DispatchRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `tracking` | `string` |

</details>

<a id="message-dispatchresponse"></a>
<details><summary>DispatchResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `status` | `string` |

</details>

<a id="message-getshipmentrequest"></a>
<details><summary>GetShipmentRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |

</details>

<a id="message-getshipmentresponse"></a>
<details><summary>GetShipmentResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `order_id` | `string` |
| `status` | `string` |
| `tracking` | `string` |
| `parcels` | `int32` |

</details>

<a id="message-recorddeliveryrequest"></a>
<details><summary>RecordDeliveryRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `signed_by` | `string` |

</details>

<a id="message-recorddeliveryresponse"></a>
<details><summary>RecordDeliveryResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |

</details>

<a id="message-recordscanrequest"></a>
<details><summary>RecordScanRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `parcel_id` | `string` |
| `location` | `string` |

</details>

<a id="message-recordscanresponse"></a>
<details><summary>RecordScanResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |

</details>

<a id="message-scanview"></a>
<details><summary>ScanView</summary>

| Field | Type |
| --- | --- |
| `parcel_id` | `string` |
| `location` | `string` |
| `scanned_at` | `string` |

</details>

<a id="message-trackshipmentrequest"></a>
<details><summary>TrackShipmentRequest</summary>

| Field | Type |
| --- | --- |
| `tracking` | `string` |

</details>

<a id="message-trackshipmentresponse"></a>
<details><summary>TrackShipmentResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `status` | `string` |
| `scans` | `[]ScanView` |

</details>
