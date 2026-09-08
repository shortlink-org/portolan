# Delivery database

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `delivery.core.pg`
- **Kind:** postgres
- **Owner:** [delivery.core](../README.md)
- **Source:** [`examples/shop/delivery/core/src/infrastructure/repository`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/repository)

## Tables

<a id="relation-delivery-core-pg-routes"></a>
### routes

aggregate-root · persists [delivery.core.route](../aggregates/route.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Route.id |
| `vehicle` | `text` | not null | — | Route.vehicle |
| `planned_for` | `date` | not null | — | Route.plannedFor |
| `status` | `text` | not null | — | Route.status |

| Index | Columns | Kind |
| --- | --- | --- |
| `routes_by_day` | planned_for, status | index |

<a id="relation-delivery-core-pg-route-stops"></a>
### route_stops

child · persists [delivery.core.route](../aggregates/route.md)

| Column | Type | Null | Key | Maps | From |
| --- | --- | --- | --- | --- | --- |
| `route_id` | `text` | not null | PK | Route.id | — |
| `seq` | `integer` | not null | PK | Route.stops.seq | — |
| `shipment_id` | `text` | not null | → [`delivery.core.pg.packages`](pg.md#relation-delivery-core-pg-packages).id (restrict) | Route.stops.shipmentId | — |
| `address` | `jsonb` | not null | — | Route.stops.address | `delivery.core.pg.packages.ship_to` |
| `window_from` | `timestamptz` | not null | — | Route.stops.window.from | — |
| `window_to` | `timestamptz` | not null | — | Route.stops.window.to | — |
| `done` | `boolean` | not null | — | Route.stops.done | — |

<a id="relation-delivery-core-pg-packages"></a>
### packages

aggregate-root · persists [delivery.core.shipment](../aggregates/shipment.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Shipment.id |
| `order_id` | `text` | not null | → [`shop.oms.pg.orders`](../../../shop/oms/stores/pg.md#relation-shop-oms-pg-orders).id (restrict) | Shipment.orderId |
| `ship_to` | `jsonb` | not null | — | Shipment.shipTo |
| `status` | `text` | not null | — | Shipment.status |
| `tracking` | `text` | null | — | Shipment.tracking.value |
| `route_id` | `text` | null | — | Shipment.routeId |
| `dispatched_at` | `timestamptz` | null | — | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `packages_by_order` | order_id | index |
| `packages_by_tracking` | tracking | unique |

<a id="relation-delivery-core-pg-parcels"></a>
### parcels

child · persists [delivery.core.shipment](../aggregates/shipment.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Shipment.parcels.id |
| `package_id` | `text` | not null | → [`delivery.core.pg.packages`](pg.md#relation-delivery-core-pg-packages).id (cascade) | Shipment.id |
| `weight_g` | `integer` | not null | — | Shipment.parcels.weightG |
| `contents` | `text` | not null | — | Shipment.parcels.contents |

<a id="relation-delivery-core-pg-scans"></a>
### scans

child · persists [delivery.core.shipment](../aggregates/shipment.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK | — |
| `parcel_id` | `text` | not null | → [`delivery.core.pg.parcels`](pg.md#relation-delivery-core-pg-parcels).id (cascade) | Shipment.scans.parcelId |
| `location` | `text` | not null | — | Shipment.scans.location |
| `scanned_at` | `timestamptz` | not null | — | Shipment.scans.scannedAt |

| Index | Columns | Kind |
| --- | --- | --- |
| `scans_by_parcel` | parcel_id, scanned_at | index |

<a id="relation-delivery-core-pg-outbox"></a>
### outbox

outbox

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK |
| `uuid` | `uuid` | not null | — |
| `topic` | `text` | not null | — |
| `payload` | `jsonb` | not null | — |
| `metadata` | `jsonb` | not null | — |
| `created_at` | `timestamptz` | not null | — |
| `published_at` | `timestamptz` | null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `outbox_unpublished` | id | index |

## Views

<a id="relation-delivery-core-pg-mv-route-load"></a>
### mv_route_load

**materialized** — rows are stored, and can be stale · reads [`delivery.core.pg.routes`](pg.md#relation-delivery-core-pg-routes), [`delivery.core.pg.route_stops`](pg.md#relation-delivery-core-pg-route-stops)

| Column | Type | Null | Maps | From |
| --- | --- | --- | --- | --- |
| `route_id` | `text` | not null | Route.id | `delivery.core.pg.routes.id` |
| `vehicle` | `text` | not null | Route.vehicle | `delivery.core.pg.routes.vehicle` |
| `planned_for` | `date` | not null | Route.plannedFor | `delivery.core.pg.routes.planned_for` |
| `stops` | `integer` | not null | Route.stops.seq | `delivery.core.pg.route_stops.seq` |
| `done` | `integer` | not null | Route.stops.seq | `delivery.core.pg.route_stops.seq` |

```sql
CREATE MATERIALIZED VIEW mv_route_load AS
SELECT r.id          AS route_id,
       r.vehicle     AS vehicle,
       r.planned_for AS planned_for,
       count(s.seq)  AS stops,
       count(s.seq) FILTER (WHERE s.done) AS done
  FROM routes r
  LEFT JOIN route_stops s ON s.route_id = r.id
 GROUP BY r.id;
```

Source: [`src/infrastructure/repository/route/migrations/0002_route_load.sql`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/repository/route/migrations/0002_route_load.sql)
