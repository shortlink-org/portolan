# Shipment

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `delivery.core.shipment`
- **Service:** [Delivery Core](../README.md)
- **Root:** `Shipment`

One parcel, from dispatch to proof of delivery.

## Attempts

A failed attempt does not fail the shipment. The shipment stays open and is
re-routed into the next window, up to three attempts.

| Attempt | Outcome            | Next                       |
| ------- | ------------------ | -------------------------- |
| 1       | no answer          | re-route, next window      |
| 2       | no answer          | re-route, next window      |
| 3       | no answer          | return to depot, flag order |

## Exceptions

An `EXCEPTION` scan stops the shipment advancing and opens a delivery
exception. What reads that queue is not in this catalog and emits no spans, so
the shipment-tracking flow ends there too — the gap is real, not a modelling
omission.

## Commands

`Dispatch`, `RecordScan` and `RecordDelivery` are the only writes. Scans
arrive from carrier webhooks and are deduplicated on the carrier scan id.

## Queries

`TrackShipment` is public-facing and rate limited per tracking reference.

## Entities

### Shipment — aggregate root

Goods on their way to one address. The unit carriers scan.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Shipment id. |
| `orderId` | `string` | Order the goods belong to. |
| `parcels` | `[]Parcel` | Physical parcels in this shipment. |
| `shipTo` | [`Address`](../../../types.md#address) | Destination. |
| `state` | `string` | held \| planned \| dispatched \| delivered \| exception. A shipment sits in `held` from order confirmation until the money is actually captured. |
| `scans` | `[]Scan` | Every carrier scan, oldest first. Append-only: a corrected scan is a new one. |

### Parcel

One box. Has its own tracking code and is scanned independently of its shipment.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Parcel id. |
| `weightGrams` | `int32` | Gross weight at dispatch. |
| `tracking` | `TrackingCode` | Carrier tracking code. |

### Scan

One reading of a parcel by a carrier. Has identity because the carrier's scan id is what a retried webhook is deduplicated on.

| Field | Type | Doc |
| --- | --- | --- |
| `carrierEventId` | `string` | The carrier's id for the scan. Deduplication is on this alone; a retried webhook carries the same one. |
| `code` | `string` | IN_TRANSIT \| DELIVERED \| EXCEPTION. The carrier's vocabulary, stored unmapped so a new code is visible rather than swallowed. |
| `scannedAt` | `time.Time` | When the carrier says it happened, which is not when we heard about it. |
| `location` | `string` | Depot or delivery point as the carrier names it. Free text; no two carriers agree. |

## Value objects

### Address

A postal address, unvalidated.

Shared type [`Address`](../../../types.md#address).

| Field | Type | Doc |
| --- | --- | --- |
| `line1` | `string` | Street and number. |
| `line2` | `string` | Optional second line. |
| `city` | `string` | City or locality. |
| `postcode` | `string` | Postal code, unvalidated. |
| `country` | `string` | ISO 3166-1 alpha-2. |

### TrackingCode

A carrier and the code it issued. Meaningless without the carrier, so the two travel together.

| Field | Type | Doc |
| --- | --- | --- |
| `carrier` | `string` | Carrier code, e.g. DHL. |
| `code` | `string` | Tracking code as issued by the carrier. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `Dispatch` | command | Releases a held shipment to a carrier and mints its tracking codes. Refused unless the payment is captured. |
| `RecordScan` | command | Appends a carrier scan, deduplicated on the carrier's scan id. An EXCEPTION scan stops the shipment advancing and opens a delivery exception. |
| `RecordDelivery` | command | Records proof of delivery and closes the shipment. Terminal: a scan arriving afterwards is stored and changes nothing. |
| `TrackShipment` | query | The public tracking view for one reference. Rate limited per reference, and returns scans rather than internal state. |
| `GetShipment` | query | The whole shipment, for callers inside the estate. This is what OMS reads before it will allow a cancellation. |

## Events

### ShipmentDispatched

`delivery.core.shipment.ShipmentDispatched`

| Consumer | Status | Note |
| --- | --- | --- |
| `analytics-sink` | declared | Registered in the traces exporter, not in any Go repo. |

#### v1 — current

A parcel physically left the depot.

Source: `internal/delivery/domain/shipment/events.go:52`

| Field | Type | Doc |
| --- | --- | --- |
| `shipmentId` | `string` | Identifier of the shipment. |
| `orderId` | `string` | Order being fulfilled. |
| `carrier` | `string` | One of inhouse, natpost, express. |
| `trackingRef` | `string` | Carrier tracking reference. |
| `shipTo` | [`Address`](../../../types.md#address) | Address the parcel is routed to. |

### ShipmentDelivered

`delivery.core.shipment.ShipmentDelivered`

| Consumer | Status | Note |
| --- | --- | --- |
| `analytics-sink` | unresolved | Observed downstream of the bus in OTel traces; owner unknown. |
| [shop.oms](../../../shop/oms/README.md) | declared | — |

#### v1 — current

Proof of delivery recorded. Terminal for the shipment.

Source: `internal/delivery/domain/shipment/events.go:97`

| Field | Type | Doc |
| --- | --- | --- |
| `shipmentId` | `string` | Identifier of the shipment. |
| `orderId` | `string` | Order that is now fulfilled. |
| `signedBy` | `string` | Name captured at the door, empty for contactless. |
| `deliveredAt` | `time.Time` | Instant of the delivery scan. |
