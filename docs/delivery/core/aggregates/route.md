# Route

*Generated from the portolan catalog · commit `3 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `delivery.core.route`
- **Service:** [Delivery Core](../README.md)
- **Root:** `Route`

A planned sequence of stops for one vehicle and one delivery window.

## Planning

Routes are planned once per window, ninety minutes before the window opens.
Shipments that miss the cut-off wait for the next window rather than forcing a
re-plan; re-planning a live route is not supported.

## Commands

| Command       | Notes                                   |
| ------------- | --------------------------------------- |
| `PlanRoute`   | Assigns vehicle and stop order          |
| `CloseRoute`  | Terminal; unfinished stops are re-queued |

## Queries

`GetRoute` returns stops in planned order, not in scan order.

## Entities

### Route — aggregate root

A day's driving for one vehicle, as planned the night before.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Route id. |
| `date` | `string` | Delivery date, ISO. |
| `vehicleId` | `string` | Vehicle assigned. |
| `stops` | `[]Stop` | Stops in driving order. |

### Stop

One address on a route. Identified by its position, which is what the driver's app shows.

| Field | Type | Doc |
| --- | --- | --- |
| `sequence` | `int32` | Position on the route, 1-based. |
| `address` | [`Address`](../../../types.md#address) | Where to stop. |
| `shipmentId` | `string` | Shipment dropped here. |

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

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `PlanRoute` | command | Sequences one window's shipments for one vehicle. Runs 90 minutes before the window opens; anything missing the cut-off waits for the next one. |
| `CloseRoute` | command | Ends a route once every stop is recorded. A route with unrecorded stops cannot be closed. |
| `GetRoute` | query | One route with its stops in driving order. |

## Events

### RoutePlanned

`delivery.core.route.RoutePlanned`

| Consumer | Status |
| --- | --- |
| [shop.oms](../../../shop/oms/README.md) | declared |

#### v1 — current

A vehicle and window were assigned a stop sequence.

Source: `internal/delivery/domain/route/events.go:38`

| Field | Type | Doc |
| --- | --- | --- |
| `routeId` | `string` | Identifier of the route. |
| `vehicleId` | `string` | Vehicle assigned to the route. |
| `stopCount` | `int32` | Number of stops on the route. |
| `windowStart` | `time.Time` | Start of the delivery window. |
