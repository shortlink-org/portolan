# Delivery Core

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `delivery.core`
- **Context:** [Delivery](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`examples/shop/delivery/core/`](https://github.com/shortlink-org/portolan/tree/main/examples/shop/delivery/core)
- **Owners:** `@shortlink-org/delivery`

Service `core` — bounded context **delivery**. TypeScript on Node.

Owns the shipment: what is being carried, where it is, and which van is taking
it there. It is told what to ship and asked where it got to; it never decides
whether something should ship at all. The vocabulary is [GLOSSARY.md](../glossary.md).

## What it does

- Dispatches a planned shipment, with the tracking code the carrier gave, and
  says `ShipmentDispatched`.
- Records every sighting of every parcel, append-only.
- Ends a shipment at the door with who signed for it — `ShipmentDelivered`.
- Plans a van's day out of the shipments waiting to go out, and closes it.
- Waits for the money: every shipment starts `awaiting-payment`, and nothing
  leaves the warehouse before the ledger says the payment was captured. The
  fact releases it - `ShipmentReleased` - and only then can it be planned and
  dispatched (core.0002).

## What it does not do

Does not price anything, does not charge anything and does not decide what to
send. A cancelled order is asked about, not argued with: the shipment is
written off.

## Publishes

`ShipmentReleased`, `ShipmentDispatched`, `ShipmentInTransit`,
`ShipmentDelivered`, `ShipmentLost` on `delivery.core.shipment`;
`RoutePlanned`, `RouteStarted`, `RouteClosed` on `delivery.core.route`. Every
arrow of both lifecycle tables is one of these.

## Provides

`delivery.v1.Delivery` — TrackShipment, GetShipment — and
`delivery.v1.RouteService` — PlanRoute, CloseRoute, GetRoute.

## Two things the store says out loud

- `packages.order_id` is a foreign key into `shop.oms.pg.orders`, another
  service's table. It crosses a boundary knowingly — neither service can
  migrate that table alone — and the catalog reports it rather than hiding it
  (core.0001).
- `route_stops.address` is a **copy** of `packages.ship_to`, which is itself the
  address handed over with the dispatch. A parcel on a van does not move because
  somebody edited their profile, which is why the value is copied and not looked
  up. The migration declares where the copy came from, in a `-- from:` line
  beside the column, because a table cannot show it the way a view shows a
  select. The order service is asked about the order's state and nothing else:
  it holds no address, and asking it for one would be asking the wrong service.

## Decisions

- [core.0001](../../adr/core.0001.md)
  — `packages.order_id` is a foreign key into the order service's table,
  knowingly.
- [core.0002](../../adr/core.0002.md) — a shipment
  waits for the money, and the ledger's fact releases it.

## Status

A sketch for the catalog, not the reference service; `examples/auth` is
that. What it has: two aggregates whose lifecycle tables are enforced and
whose every move is an event, use cases that answer with what a caller may
see, a policy that reacts to the ledger's fact through a use case, Postgres
repositories behind both ports that write the events to an outbox in the
same transaction, and the records above. What it deliberately does not have
yet, and the review skill will name: no server, so nothing here listens; no
version on the aggregates, so a stale write wins; no unit of work, so
`plan_route` writes a route and its shipments one save at a time; no
sentinel errors or status mapping at the edge; no tracing. Each is a known
gap, not an oversight, and none of them changes what the catalog shows.

## Running it

```bash
docker compose up -d db
npm install && npm run gen && npm run build
```

The repository tests bring up their own Postgres through Docker and are
skipped without it:

```bash
npm test
```

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Route](aggregates/route.md) | `Route` | 3 commands | 1 query | 3 events |
| [Shipment](aggregates/shipment.md) | `Shipment` | 4 commands | 2 queries | 5 events |

## Provides

### delivery.v1.Delivery

- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/proto/delivery/v1/delivery.proto:9`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/proto/delivery/v1/delivery.proto#L9)
- **Module:** [buf.build/shortlink-org/portolan-delivery-shipment](../../modules/shortlink-org-portolan-delivery-shipment.md)

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

### delivery.v1.RouteService

- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/route/proto/delivery/v1/routes.proto:6`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/route/proto/delivery/v1/routes.proto#L6)
- **Module:** [buf.build/shortlink-org/portolan-delivery-route](../../modules/shortlink-org-portolan-delivery-route.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `CloseRoute` | `CloseRouteRequest` | `CloseRouteResponse` | End the day, whatever is left undone. |
| `GetRoute` | `GetRouteRequest` | `GetRouteResponse` | One route, in the order it is driven. |
| `PlanRoute` | `PlanRouteRequest` | `PlanRouteResponse` | Build a day out of the shipments waiting to go out. |
| `StartRoute` | `StartRouteRequest` | `StartRouteResponse` | The van is out. |

<a id="message-closerouterequest"></a>
<details><summary>CloseRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-closerouteresponse"></a>
<details><summary>CloseRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-getrouterequest"></a>
<details><summary>GetRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-getrouteresponse"></a>
<details><summary>GetRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |
| `vehicle` | `string` |
| `status` | `string` |
| `stops` | `[]StopView` |

</details>

<a id="message-planrouterequest"></a>
<details><summary>PlanRouteRequest</summary>

| Field | Type |
| --- | --- |
| `vehicle` | `string` |
| `planned_for` | `string` |
| `shipment_ids` | `[]string` |

</details>

<a id="message-planrouteresponse"></a>
<details><summary>PlanRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |
| `stops` | `int32` |

</details>

<a id="message-startrouterequest"></a>
<details><summary>StartRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-startrouteresponse"></a>
<details><summary>StartRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-stopview"></a>
<details><summary>StopView</summary>

| Field | Type |
| --- | --- |
| `seq` | `int32` |
| `shipment_id` | `string` |
| `address` | `string` |
| `done` | `bool` |

</details>

## Consumes

| Call | Peer | Status | Source |
| --- | --- | --- | --- |
| `shop.v1.OrderService/GetOrder` | [shop.oms](../../shop/oms/README.md) | declared | [`examples/shop/delivery/core/src/infrastructure/oms/proto/shop/v1/orders.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/oms/proto/shop/v1/orders.proto) |

## Publishes

| Event | Latest |
| --- | --- |
| [`RouteClosed`](aggregates/route.md#event-delivery-core-route-routeclosed) | v1 |
| [`RoutePlanned`](aggregates/route.md#event-delivery-core-route-routeplanned) | v1 |
| [`RouteStarted`](aggregates/route.md#event-delivery-core-route-routestarted) | v1 |
| [`ShipmentDelivered`](aggregates/shipment.md#event-delivery-core-shipment-shipmentdelivered) | v1 |
| [`ShipmentDispatched`](aggregates/shipment.md#event-delivery-core-shipment-shipmentdispatched) | v1 |
| [`ShipmentInTransit`](aggregates/shipment.md#event-delivery-core-shipment-shipmentintransit) | v1 |
| [`ShipmentLost`](aggregates/shipment.md#event-delivery-core-shipment-shipmentlost) | v1 |
| [`ShipmentReleased`](aggregates/shipment.md#event-delivery-core-shipment-shipmentreleased) | v1 |

## Schema modules

| Module | Access | Packages |
| --- | --- | --- |
| [shortlink-org/portolan-delivery-route](../../modules/shortlink-org-portolan-delivery-route.md) | publishes | delivery.v1 |
| [shortlink-org/portolan-delivery-shipment](../../modules/shortlink-org-portolan-delivery-shipment.md) | publishes | delivery.v1 |

## Stores

| Store | Kind | Access | Schema |
| --- | --- | --- | --- |
| [Delivery database](stores/pg.md) | postgres | owns | 6 tables |

## Commands

| Run | Body | Source |
| --- | --- | --- |
| `npm run build` | `tsc -p tsconfig.build.json` | [`examples/shop/delivery/core/package.json:9`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/package.json#L9) |
| `npm run typecheck` | `tsc --noEmit` | [`examples/shop/delivery/core/package.json:10`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/package.json#L10) |
| `npm run gen` | `buf generate src/infrastructure/transport/grpc/shipment/proto -o src/infrastructure/transport/grpc/shipment/gen && buf generate src/infrastructure/transport/grpc/route/proto -o src/infrastructure/transport/grpc/route/gen && buf generate src/infrastructure/oms/proto -o src/infrastructure/oms/gen` | [`examples/shop/delivery/core/package.json:11`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/package.json#L11) |
| `npm test` | `vitest run` | [`examples/shop/delivery/core/package.json:12`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/package.json#L12) |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [core.0001](../../adr/core.0001.md) | `packages.order_id` is a foreign key into the order service's table | accepted | 2026-09-05 |
| [core.0002](../../adr/core.0002.md) | A shipment waits for the money, and the ledger's fact releases it | accepted | 2026-09-05 |
