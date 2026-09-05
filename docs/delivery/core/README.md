# Delivery Core

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `delivery.core`
- **Context:** [Delivery](../README.md)
- **Repo:** `github.com/shortlink-org/portolan`
- **Path:** `examples/shop/delivery/core`
- **Owners:** `@shortlink-org/delivery`

Service `core` — bounded context **delivery**. TypeScript on Node.

Owns the shipment: what is being carried, where it is, and which van is taking
it there. It is told what to ship and asked where it got to; it never decides
whether something should ship at all. The vocabulary is [GLOSSARY.md](GLOSSARY.md).

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

- [core.0001](docs/adr/0001-packages-order-id-is-a-foreign-key-into-another-service.md)
  — `packages.order_id` is a foreign key into the order service's table,
  knowingly.
- [core.0002](docs/adr/0002-a-shipment-waits-for-the-money.md) — a shipment
  waits for the money, and the ledger's fact releases it.

## Status

A sketch for the catalog, not the reference service; `examples/auth` is
that. What it has: two aggregates whose lifecycle tables are enforced and
whose every move is an event, use cases that answer with what a caller may
see, a policy that reacts to the ledger's fact through a use case, and the
records above. What it deliberately does not have yet, and the review skill
will name: no repository or server behind the ports, so nothing here runs;
no version on the aggregates; no unit of work, so `plan_route` writes a
route and its shipments one save at a time; no sentinel errors or status
mapping at the edge; no tests; no tracing. Each is a known gap, not an
oversight, and none of them changes what the catalog shows.

## Running it

```bash
docker compose up -d db
npm install && npm run gen && npm run build
```

## Aggregates

| Aggregate | Root | Commands | Queries | Events |
| --- | --- | --- | --- | --- |
| [Route](aggregates/route.md) | `Route` | 3 commands | 1 query | 3 events |
| [Shipment](aggregates/shipment.md) | `Shipment` | 4 commands | 2 queries | 5 events |

## Provides

**`delivery.v1.Delivery`** — `examples/shop/delivery/core/src/infrastructure/transport/grpc/shipment/proto/delivery/v1/delivery.proto:9`

- `Dispatch`
- `RecordScan`
- `RecordDelivery`
- `TrackShipment`
- `GetShipment`

<details><summary>DispatchRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `tracking` | `string` |

</details>

<details><summary>DispatchResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `status` | `string` |

</details>

<details><summary>RecordScanRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `parcel_id` | `string` |
| `location` | `string` |

</details>

<details><summary>RecordScanResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |

</details>

<details><summary>RecordDeliveryRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `signed_by` | `string` |

</details>

<details><summary>RecordDeliveryResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |

</details>

<details><summary>TrackShipmentRequest</summary>

| Field | Type |
| --- | --- |
| `tracking` | `string` |

</details>

<details><summary>TrackShipmentResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `status` | `string` |
| `scans` | `[]ScanView` |

</details>

<details><summary>GetShipmentRequest</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |

</details>

<details><summary>GetShipmentResponse</summary>

| Field | Type |
| --- | --- |
| `shipment_id` | `string` |
| `order_id` | `string` |
| `status` | `string` |
| `tracking` | `string` |
| `parcels` | `int32` |

</details>

<details><summary>ScanView</summary>

| Field | Type |
| --- | --- |
| `parcel_id` | `string` |
| `location` | `string` |
| `scanned_at` | `string` |

</details>

**`delivery.v1.RouteService`** — `examples/shop/delivery/core/src/infrastructure/transport/grpc/route/proto/delivery/v1/routes.proto:6`

- `PlanRoute`
- `StartRoute`
- `CloseRoute`
- `GetRoute`

<details><summary>PlanRouteRequest</summary>

| Field | Type |
| --- | --- |
| `vehicle` | `string` |
| `planned_for` | `string` |
| `shipment_ids` | `[]string` |

</details>

<details><summary>PlanRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |
| `stops` | `int32` |

</details>

<details><summary>StartRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<details><summary>StartRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<details><summary>CloseRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<details><summary>CloseRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<details><summary>GetRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<details><summary>GetRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |
| `vehicle` | `string` |
| `status` | `string` |
| `stops` | `[]StopView` |

</details>

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
| `shop.v1.OrderService/GetOrder` | [shop.oms](../../shop/oms/README.md) | declared | `examples/shop/delivery/core/src/infrastructure/oms/proto/shop/v1/orders.proto` |

## Publishes

| Event | Latest |
| --- | --- |
| [RouteClosed](aggregates/route.md) | v1 |
| [RoutePlanned](aggregates/route.md) | v1 |
| [RouteStarted](aggregates/route.md) | v1 |
| [ShipmentDelivered](aggregates/shipment.md) | v1 |
| [ShipmentDispatched](aggregates/shipment.md) | v1 |
| [ShipmentInTransit](aggregates/shipment.md) | v1 |
| [ShipmentLost](aggregates/shipment.md) | v1 |
| [ShipmentReleased](aggregates/shipment.md) | v1 |

## Stores

| Store | Kind | Access | Tables |
| --- | --- | --- | --- |
| [Delivery database](stores/pg.md) | postgres | owns | 5 tables |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [core.0001](../../adr/core.0001.md) | `packages.order_id` is a foreign key into the order service's table | accepted | 2026-09-05 |
| [core.0002](../../adr/core.0002.md) | A shipment waits for the money, and the ledger's fact releases it | accepted | 2026-09-05 |
