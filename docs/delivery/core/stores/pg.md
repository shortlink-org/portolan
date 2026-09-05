# Delivery database

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `delivery.core.pg`
- **Kind:** postgres
- **Owner:** [delivery.core](../README.md)
- **Source:** `examples/shop/delivery/core/src/infrastructure/repository`

## Tables

### routes

aggregate-root · persists [delivery.core.route](../aggregates/route.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `text` | not null | PK |
| `vehicle` | `text` | not null | — |
| `planned_for` | `date` | not null | — |
| `status` | `text` | not null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `routes_by_day` | planned_for, status | index |

### route_stops

child · persists [delivery.core.route](../aggregates/route.md)

| Column | Type | Null | Key | From |
| --- | --- | --- | --- | --- |
| `route_id` | `text` | not null | PK | — |
| `seq` | `integer` | not null | PK | — |
| `shipment_id` | `text` | not null | → [`delivery.core.pg.packages`](pg.md#packages).id (restrict) | — |
| `address` | `text` | not null | — | `delivery.core.pg.packages.ship_to` |
| `window_from` | `timestamptz` | not null | — | — |
| `window_to` | `timestamptz` | not null | — | — |
| `done` | `boolean` | not null | — | — |

### packages

aggregate-root · persists [delivery.core.shipment](../aggregates/shipment.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `text` | not null | PK |
| `order_id` | `text` | not null | → [`shop.oms.pg.orders`](../../../shop/oms/stores/pg.md#orders).id (restrict) |
| `ship_to` | `text` | not null | — |
| `status` | `text` | not null | — |
| `tracking` | `text` | null | — |
| `route_id` | `text` | null | — |
| `dispatched_at` | `timestamptz` | null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `packages_by_order` | order_id | index |
| `packages_by_tracking` | tracking | unique |

### parcels

child · persists [delivery.core.shipment](../aggregates/shipment.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `text` | not null | PK |
| `package_id` | `text` | not null | → [`delivery.core.pg.packages`](pg.md#packages).id (cascade) |
| `weight_g` | `integer` | not null | — |
| `contents` | `text` | not null | — |

### scans

child · persists [delivery.core.shipment](../aggregates/shipment.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `bigserial` | not null | PK |
| `parcel_id` | `text` | not null | → [`delivery.core.pg.parcels`](pg.md#parcels).id (cascade) |
| `location` | `text` | not null | — |
| `scanned_at` | `timestamptz` | not null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `scans_by_parcel` | parcel_id, scanned_at | index |

## Views

### mv_route_load

**materialized** — rows are stored, and can be stale · reads [`delivery.core.pg.routes`](pg.md#routes), [`delivery.core.pg.route_stops`](pg.md#route_stops)

| Column | Type | Null | From |
| --- | --- | --- | --- |
| `route_id` | `text` | not null | `delivery.core.pg.routes.id` |
| `vehicle` | `text` | not null | `delivery.core.pg.routes.vehicle` |
| `planned_for` | `date` | not null | `delivery.core.pg.routes.planned_for` |
| `stops` | `integer` | not null | `delivery.core.pg.route_stops.seq` |
| `done` | `integer` | not null | `delivery.core.pg.route_stops.seq` |

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

Source: `src/infrastructure/repository/route/migrations/0002_route_load.sql`
