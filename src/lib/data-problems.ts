// Where the schema and the model disagree.
//
// The unresolved edges in derive.ts are about arrows that land nowhere. These
// are about arrows that land somewhere they should not, and about two claims
// in the catalog that cannot both be current. They share one shape and one
// page, because a reader scanning Problems asks the same question of all of
// them: what do I have to go and look at?
//
// Errors are boundary leaks — one service reaching into another's schema. They
// are errors because no amount of context makes them fine: a foreign key across
// a service boundary is a deployment order nobody wrote down, and a second
// writer in someone else's database is a bounded context with two owners.
//
// Warnings are staleness. A table that no longer carries the fields it claims,
// a column whose type has drifted from its field's — both are ordinary during a
// migration, so they are reported and not enforced.

import type {
  Catalog,
  CatalogIndex,
  Column,
  Store,
  Table,
} from "../catalog";
import {
  aggregateBlocks,
  blockFields,
  mapsFieldPath,
  relationOfColumnId,
  storeViews,
  viewReads,
} from "../catalog";
import type { Problem } from "./derive";
import { payloadColumn, typesDisagree } from "./data-model";

/** The context a store sits in, via the service that owns it. */
function contextOf(index: CatalogIndex, serviceId: string): string {
  return index.serviceContext.get(serviceId)?.id ?? "";
}

/**
 * Every persistence problem, stores in catalog order and tables in theirs.
 * Errors first within each store, so the boundary leaks are not buried under
 * a column-by-column type audit.
 */
export function dataProblems(
  catalog: Catalog,
  index: CatalogIndex,
): Problem[] {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];

  for (const store of catalog.stores ?? []) {
    for (const table of store.tables) {
      errors.push(...crossServiceKeys(index, store, table));
      errors.push(...sharedStore(index, store, table));
      warnings.push(...outboxWithoutPayload(index, store, table));
      warnings.push(...drift(catalog, index, store, table));
      warnings.push(...typeDrift(catalog, index, store, table));
      warnings.push(
        ...crossServiceLineage(index, store, table.id, table.columns),
      );
    }
    for (const view of storeViews(store)) {
      warnings.push(...crossServiceLineage(index, store, view.id, view.columns));
      // A view is defined over what it reads, so a `reads` entry pointing into
      // someone else's store is the same coupling stated one level up.
      for (const readId of viewReads(view)) {
        const target =
          index.tableById.get(readId) ?? index.viewById.get(readId);
        if (!target || target.store.owner === store.owner) continue;
        warnings.push({
          kind: "cross-service-lineage",
          severity: "warning",
          context: contextOf(index, store.owner),
          service: store.owner,
          id: view.id,
          peer: readId,
          note: `${view.id} is defined over ${readId}, which ${target.store.owner} owns; a rename over there breaks this view with no error until it is read.`,
          source: view.source ?? store.source,
        });
      }
    }
  }

  return [...errors, ...warnings];
}

/**
 * A foreign key into a table another service owns. The database will enforce
 * it, which is the problem: two services are now one schema, and neither can
 * migrate its own table without the other's release.
 */
function crossServiceKeys(
  index: CatalogIndex,
  store: Store,
  table: Table,
): Problem[] {
  const out: Problem[] = [];
  for (const column of table.columns) {
    if (!column.fk) continue;
    const target = index.tableById.get(column.fk.table);
    if (!target || target.store.owner === store.owner) continue;
    out.push({
      kind: "cross-service-fk",
      severity: "error",
      context: contextOf(index, store.owner),
      service: store.owner,
      id: `${table.id}.${column.name}`,
      peer: column.fk.table,
      note: `${store.owner} holds a foreign key into a table owned by ${target.store.owner}; neither service can migrate that table alone.`,
      source: store.source,
    });
  }
  return out;
}

/**
 * A column copied from another service's schema.
 *
 * Not an error: copying is how a projection is built, and the alternative — a
 * foreign key — is worse. It is a warning because the coupling is invisible
 * from the other side. Nothing in the source database records that someone
 * else's column is a copy of it, so the rename that breaks this is a rename
 * that looked safe.
 */
function crossServiceLineage(
  index: CatalogIndex,
  store: Store,
  relationId: string,
  columns: Column[],
): Problem[] {
  const out: Problem[] = [];
  const seen = new Set<string>();
  for (const column of columns) {
    for (const ref of column.from ?? []) {
      const source = relationOfColumnId(ref);
      const target =
        index.tableById.get(source) ?? index.viewById.get(source);
      if (!target || target.store.owner === store.owner) continue;
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push({
        kind: "cross-service-lineage",
        severity: "warning",
        context: contextOf(index, store.owner),
        service: store.owner,
        id: `${relationId}.${column.name}`,
        peer: ref,
        note: `${store.owner} copies this value from ${ref}, which ${target.store.owner} owns; nothing on that side records that the copy exists.`,
        source: store.source,
      });
    }
  }
  return out;
}

/**
 * A table in one service's store that holds another service's aggregate. An
 * aggregate is written by the service that owns it, so this is a second writer
 * in someone else's database — reading is allowed and is drawn ghosted, but
 * this is not reading.
 */
function sharedStore(
  index: CatalogIndex,
  store: Store,
  table: Table,
): Problem[] {
  const aggregateId = table.persists?.aggregate;
  if (!aggregateId) return [];
  // A projection is a COPY of someone else's aggregate, maintained locally
  // from their events. That is the pattern this rule exists to make room for,
  // not the one it is looking for.
  if (table.role === "projection") return [];
  const writer = index.aggregateOwner.get(aggregateId);
  if (!writer || writer.id === store.owner) return [];
  return [
    {
      kind: "shared-store",
      severity: "error",
      context: contextOf(index, store.owner),
      service: store.owner,
      id: table.id,
      peer: writer.id,
      note: `${store.id} is owned by ${store.owner}, but this table holds ${aggregateId}, which ${writer.id} writes.`,
      source: store.source,
    },
  ];
}

/**
 * An outbox with nothing to deliver. The whole point of the pattern is that the
 * event body is committed in the same transaction as the state change, so an
 * outbox with no payload column is either not an outbox or not finished.
 */
function outboxWithoutPayload(
  index: CatalogIndex,
  store: Store,
  table: Table,
): Problem[] {
  if (table.role !== "outbox" || payloadColumn(table)) return [];
  return [
    {
      kind: "outbox-payload",
      severity: "warning",
      context: contextOf(index, store.owner),
      service: store.owner,
      id: table.id,
      peer: store.id,
      note: "an outbox carries the event body in the same transaction as the state change; this table declares no json column to hold one",
      source: store.source,
    },
  ];
}

/**
 * A table that claims an aggregate none of its columns carry. Either the table
 * was relabelled and the columns were not, or the aggregate moved on without
 * it; both leave the `persists` claim asserting more than it can back up.
 */
function drift(
  catalog: Catalog,
  index: CatalogIndex,
  store: Store,
  table: Table,
): Problem[] {
  const aggregateId = table.persists?.aggregate;
  if (!aggregateId) return [];
  // A derived table holds a copy shaped for reading, not the aggregate's own
  // fields, so it has nothing to have drifted FROM. Only a table that claims
  // to BE where the aggregate lives can contradict it.
  if (table.role === "projection" || table.role === "outbox") return [];
  const aggregate = index.aggregateById.get(aggregateId);
  if (!aggregate) return [];

  const declared = new Set<string>();
  for (const { block } of aggregateBlocks(aggregate)) {
    for (const field of blockFields(catalog, block)) declared.add(field.name);
  }
  // Nothing to drift from: an aggregate whose blocks are known by name only
  // cannot contradict a schema.
  if (declared.size === 0) return [];

  const mapped = table.columns.filter((c) => {
    if (!c.maps) return false;
    const head = mapsFieldPath(c.maps).split(".")[0] ?? "";
    return declared.has(head);
  });
  if (mapped.length > 0) return [];

  const claimed = table.columns.filter((c) => c.maps).length;
  return [
    {
      kind: "persistence-drift",
      severity: "warning",
      context: contextOf(index, store.owner),
      service: store.owner,
      id: table.id,
      peer: aggregateId,
      note:
        claimed === 0
          ? `no column of ${table.name} maps to a field of ${aggregateId}`
          : `${claimed} column(s) of ${table.name} map to fields ${aggregateId} no longer declares`,
      source: store.source,
    },
  ];
}

/**
 * A column and the field it carries that no longer agree on a type. One of the
 * two has been changed and the other has not; which one is the reader's call,
 * so the problem names both and stops there.
 */
function typeDrift(
  catalog: Catalog,
  index: CatalogIndex,
  store: Store,
  table: Table,
): Problem[] {
  const out: Problem[] = [];
  const aggregateId = table.persists?.aggregate;
  const aggregate = aggregateId
    ? index.aggregateById.get(aggregateId)
    : undefined;
  if (!aggregate) return out;

  const fields = new Map<string, string>();
  for (const { block } of aggregateBlocks(aggregate)) {
    for (const field of blockFields(catalog, block)) {
      // First declaration wins: two blocks of one aggregate naming the same
      // field agree about it far more often than not, and a column mapping to
      // "Id" is not made clearer by picking the second one.
      if (!fields.has(field.name)) fields.set(field.name, field.type);
    }
  }

  for (const column of table.columns) {
    if (!column.maps) continue;
    const head = mapsFieldPath(column.maps).split(".")[0] ?? "";
    const domainType = fields.get(head);
    if (!domainType || !typesDisagree(column.type, domainType)) continue;
    out.push({
      kind: "column-type",
      severity: "warning",
      context: contextOf(index, store.owner),
      service: store.owner,
      id: `${table.id}.${column.name}`,
      peer: column.maps,
      note: `column is ${column.type}, ${column.maps} is ${domainType}`,
      source: store.source,
    });
  }
  return out;
}
