# How the catalog draws the read side

The portolan catalog already has a vocabulary for everything this skill
asks for. Use it, so the canvas shows the structural fact a reader came
for: which rows are the aggregate, which are a copy, and which can be
stale.

## Table roles

`Table.role` is one of `aggregate-root`, `child`, `outbox`, `projection`,
`lookup`, `other` (`src/catalog.ts`). A projection is drawn differently from
the table that holds the aggregate, and the data checks in
`src/lib/data-problems.ts` treat a column copied into a projection as how
a projection is built. A table with that role is exempt from the
shared-store error (a projection of another service's aggregate is the one
copy that rule exists to make room for) and from the drift check (a copy
shaped for reading has nothing to have drifted from). A column copied from
another service's schema is still a warning, deliberately: the coupling is
invisible from the other side, and the rename that breaks it looks safe
there.

The SQL extractor (`plugins/extract-sql/store.go`) assigns four of the
roles, by layout. In a repository package a table named `outbox` or
`*_outbox` is the outbox, the first table an aggregate's migrations create
is the aggregate root, and every later one is a child. Every table a
projector package creates - `internal/infrastructure/projector/<projection>/
migrations/`, the `projectors` option of the plugin - is a projection. The
layout cannot say whose rows a projection pictures (the aggregate may belong
to another service), so that is written in the migration, above the
`CREATE TABLE`, in the form a copied column already uses:

```sql
-- Planned stops, rebuilt from RoutePlanned.
-- aggregate: shop.oms.order
CREATE TABLE route_stops (
```

A bare slug (`route`) is an aggregate of the service that owns the store; a
dotted name is a full id. Without the line the table is still a projection
and `persists` is left out. A projection declared in a repository package is
read as that aggregate's child: put it in a projector package.

## Lineage

A column copied from somewhere else says so in the migration, in the one
form a migration already has for speaking to a person:

```sql
-- from: shop.oms.pg.orders.ship_to
ship_to text NOT NULL,
```

The extractor reads it into `Column.from`, and the canvas draws the edge.
A copy inside the store may leave the store id out (`orders.ship_to`); a
copy from another service's schema is spelled in full. This is the one
place a copy of a foreign fact is written down where it will be read, so
every projection column that is a copy carries it.

## Views

`CREATE VIEW` and `CREATE MATERIALIZED VIEW` become `View` entries with
`reads` (what they are defined over) and, for a matview, `materialized:
true`. The canvas draws a materialized view as one whose rows can be stale,
because that is the one fact a reader has to have before believing a row.
A view has no role and no migrations of its own; what it has is the list of
things it reads, and that list is the only reason it is on the canvas.

## What the estate shows today

- `examples/shop/delivery`: `mv_route_load`, a materialized view kept
  because the depot board asks every few seconds and the answer changes by
  the hour. No use case reads it yet.
- The frozen UI fixture (`src/testing/estate`) has `route_stops` as a
  projection with an `address` column copied `from` the package's
  `ship_to`; it is the picture to compare a real projection against.
- Every `get_*` and `list_*` in the examples is the first form: a read
  through the repository. `auth/get` maps to a DTO; the others still
  return the root.
