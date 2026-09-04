# Delivery database

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `delivery.core.pg`
- **Kind:** postgres
- **Owner:** [delivery.core](../README.md)
- **Source:** `delivery/core/db/migrations`

## Tables

### packages

aggregate-root · persists [delivery.core.shipment](../aggregates/shipment.md)

One row per shipment. order_id is a real foreign key into the OMS database — see Problems.

| Column | Type | Null | Key | Maps | Doc |
| --- | --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Shipment.id | — |
| `order_id` | `uuid` | not null | → [`shop.oms.pg.orders`](../../../shop/oms/stores/pg.md#orders).id (restrict) | Shipment.orderId | — |
| `state` | `text` | not null | — | Shipment.state | — |
| `ship_to` | `jsonb` | not null | — | Shipment.shipTo | Copied off the order when the shipment is created; the real order carries no address yet, so nothing says where this comes from. |
| `dispatched_at` | `timestamptz` | null | — | — | — |

### parcels

child · persists [delivery.core.shipment](../aggregates/shipment.md) · block `delivery.core.shipment.parcel`

Parcels inside a shipment.

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Parcel.id |
| `package_id` | `text` | not null | → [`delivery.core.pg.packages`](pg.md#packages).id (cascade) | — |
| `weight_grams` | `integer` | not null | — | Parcel.weightGrams |
| `tracking` | `text` | not null | — | Parcel.tracking |

### route_stops

projection · persists [delivery.core.route](../aggregates/route.md)

Planned stops, rebuilt from RoutePlanned. Derived, not a source of truth.

| Column | Type | Null | Key | From | Doc |
| --- | --- | --- | --- | --- | --- |
| `route_id` | `text` | not null | PK | — | — |
| `seq` | `integer` | not null | PK | — | — |
| `package_id` | `text` | null | → [`delivery.core.pg.packages`](pg.md#packages).id | — | — |
| `address` | `jsonb` | not null | — | `delivery.core.pg.packages.ship_to` | Denormalised from the package, so a route can be printed without a join. |

## Views

### mv_route_load

**materialized** — rows are stored, and can be stale · reads [`delivery.core.pg.route_stops`](pg.md#route_stops), [`delivery.core.pg.parcels`](pg.md#parcels)

Stops and weight per route, refreshed after each plan. The catalog knows what it reads, not which column feeds which.

| Column | Type | Null |
| --- | --- | --- |
| `route_id` | `text` | not null |
| `stops` | `bigint` | not null |
| `weight_grams` | `bigint` | null |

```sql
CREATE MATERIALIZED VIEW mv_route_load AS
SELECT s.route_id, count(*) AS stops, sum(p.weight_grams) AS weight_grams
  FROM route_stops s
  LEFT JOIN parcels p ON p.package_id = s.package_id
 GROUP BY s.route_id;
```

Source: `delivery/core/db/migrations/0005_route_load.sql`
