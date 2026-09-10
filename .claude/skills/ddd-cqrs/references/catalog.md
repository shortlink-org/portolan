# Catalog representation of the read side

Use the existing catalog vocabulary for aggregate tables, projections, views
and copied columns; do not introduce a second architecture model in a README.

Inspect [catalog types](../../../../src/catalog-model.ts),
[SQL extraction](../../../../plugins/extract-sql/store.go) and the target's
extractor configuration before choosing discovery paths. Current auth uses
module-local infrastructure; old `internal/infrastructure/projector/...` paths
are not a layout prescription for a new module. If the configured extractor
cannot discover the chosen path, report or fix that specific integration rather
than silently moving the module back to a horizontal layout.

## Roles and lineage

Projection tables use role `projection`, separate from `aggregate-root`, `child`
and `outbox`. A migration can describe its aggregate and copied facts:

```sql
-- aggregate: shop.oms.order
CREATE TABLE route_stops (
    order_id text PRIMARY KEY,
    -- from: shop.oms.pg.orders.ship_to
    ship_to text NOT NULL
);
```

The `-- from:` comment describes lineage; it does not authorize a projector to
read the peer's table. Data arrives through its public integration stream.
Projection checkpoints must reflect the strict version contract from
[events](../../ddd-domain-event/SKILL.md); a drawn lineage edge does not prove
ordering, freshness or replayability.

`CREATE VIEW` and `CREATE MATERIALIZED VIEW` describe read dependencies. State
refresh behaviour and freshness in the query documentation. Do not infer current
example coverage from a frozen fixture; inspect the target's generated output.

## Verify a changed catalog

Follow project AGENTS.md: inspect the source fragment and merged catalog, run
`npm run gen` and `npm run likec4:gen` when diagrams are involved, reload the same
preview with cache busting (restart an eager dev server when needed), then inspect
the actual rendered read-side region. State which layers were verified. Merely
updating these skill instructions requires no catalog or UI regeneration.
