// Persistence: stores, their tables, views, columns and Redis keyspaces, and
// the helpers that read lineage and spell a column's id.

import type { Catalog } from "./catalog.ts";
import type { RelationEvidence } from "./shared.ts";

// ---------------------------------------------------------------------------
// Persistence. Where an aggregate actually lives when nothing is running.
//
// This axis is deliberately shallow: a store, its tables, their columns, and
// the foreign keys between them. It says nothing about how the rows got there.
// What it does say — through `persists` and `maps` — is which domain object a
// table holds and which domain field a column carries, which is the only
// question that makes a schema readable next to a model rather than beside it.
// ---------------------------------------------------------------------------

export type StoreKind =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "redis"
  | "mongodb"
  | "clickhouse"
  | "s3"
  | "dynamodb"
  | "other";

export const STORE_KINDS: readonly StoreKind[] = [
  "postgres",
  "mysql",
  "sqlite",
  "redis",
  "mongodb",
  "clickhouse",
  "s3",
  "dynamodb",
  "other",
] as const;

export interface Store {
  id: string; // "shop.oms.pg"
  slug: string;
  name: string;
  kind: StoreKind;
  /** Service id. Exactly one service owns a store; everyone else reads it. */
  owner: string;
  tables: Table[];
  /**
   * Views declared over those tables. Optional in the file for the same reason
   * `stores` is: a catalog written before the extractor learned to read
   * `CREATE VIEW` still loads, and every reader sees an empty list.
   */
  views?: View[];
  /** Redis key families proved by client calls. Dynamic parts use `{name}`. */
  keyspaces?: RedisKeyspace[];
  /** Migrations directory or config path, as a reader would open it. */
  source?: string;
}

export type RedisOperation =
  "read" | "write" | "delete" | "exists" | "expire" | "count";

export const REDIS_OPERATIONS: readonly RedisOperation[] = [
  "read",
  "write",
  "delete",
  "exists",
  "expire",
  "count",
] as const;

/** A source-backed family of Redis keys, not a relational table. */
export interface RedisKeyspace {
  pattern: string;
  operations: RedisOperation[];
  /** Source spelling of a fixed, configured or caller-provided expiry. */
  ttl?: string;
  /** Value type where a write or marshal call proves it. */
  value?: string;
  source?: string;
  /** Aggregate or block whose value this key family holds, when provable. */
  persists?: { aggregate?: string; block?: string; evidence?: RelationEvidence[] };
  /** Individual client calls, before they are folded into `operations`. */
  accesses?: RedisAccess[];
}

export interface RedisAccess {
  operation: RedisOperation;
  /** Enclosing adapter method, for example `Store.Get`. */
  method?: string;
  ttl?: string;
  value?: string;
  source?: string;
}

/**
 * What a table is FOR. The role is not decoration: an outbox and a projection
 * are read completely differently from the table that holds the aggregate, and
 * a canvas that draws all three the same way hides the only structural fact a
 * reader came for.
 */
export type TableRole =
  "aggregate-root" | "child" | "outbox" | "projection" | "lookup" | "other";

export const TABLE_ROLES: readonly TableRole[] = [
  "aggregate-root",
  "child",
  "outbox",
  "projection",
  "lookup",
  "other",
] as const;

export interface Table {
  evidence?: RelationEvidence[];
  id: string; // "<store id>.<table>"
  name: string;
  doc?: string;
  columns: Column[];
  indexes?: TableIndex[];
  /** The domain object this table holds: an aggregate id, and optionally a block id. */
  persists?: { aggregate?: string; block?: string; evidence?: RelationEvidence[] };
  role?: TableRole;
  /** Source-backed repository methods that read or write this table. */
  accesses?: TableAccess[];
}

export type TableOperation = "read" | "write" | "delete";

export const TABLE_OPERATIONS: readonly TableOperation[] = [
  "read",
  "write",
  "delete",
] as const;

export interface TableAccess {
  operation: TableOperation;
  /** Enclosing adapter method, for example `Postgres.Save`. */
  method?: string;
  source?: string;
}

export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface Column {
  name: string;
  /** The db type as declared — uuid, timestamptz, jsonb — not a normalised one. */
  type: string;
  nullable: boolean;
  pk?: boolean;
  /** `table` is a Table.id, so a foreign key names its target unambiguously. */
  fk?: { table: string; column: string; onDelete?: string };
  /**
   * The columns this one is computed from, as "<table or view id>.<column>".
   *
   * A foreign key says which row this value points AT; lineage says where the
   * value CAME FROM, which is a different question and the only one that can
   * be asked of a view column or of a projection rebuilt from an event. It is
   * declared on the derived end because that is the end that knows: a source
   * table has no idea who reads it.
   */
  from?: string[];
  /** Domain field path, e.g. "Order.CustomerID". */
  maps?: string;
  doc?: string;
}

/**
 * A view: a query the database has a name for.
 *
 * It is kept apart from Table rather than folded in behind a flag because the
 * two answer different questions. A table is where rows live; a view is a
 * reading of rows that live somewhere else, so it has no primary key, no
 * foreign keys, and no migrations of its own — what it has instead is the list
 * of things it reads, which is the only reason it is on the canvas at all.
 */
export interface View {
  id: string; // "<store id>.<view name>"
  name: string;
  doc?: string;
  /**
   * True when the database keeps the rows rather than recomputing them. A
   * matview can be stale, which is the one fact a reader has to have before
   * believing a row, so it is drawn differently rather than noted in prose.
   */
  materialized?: boolean;
  columns: Column[];
  /**
   * Tables and views this one is defined over, by id. Column lineage already
   * implies most of them; this is what a view whose columns nobody has mapped
   * still says out loud, and it is what the canvas draws when a column-level
   * edge would be a guess.
   */
  reads?: string[];
  /** The SELECT, as the migration declares it. Shown, never parsed. */
  definition?: string;
  /** The domain object this view presents, when it presents exactly one. */
  persists?: { aggregate?: string; block?: string; evidence?: RelationEvidence[] };
  /** Migration or model file, as a reader would open it. */
  source?: string;
}

/** Every store, whether or not any service lists it. Absent means none. */
export function allStores(catalog: Catalog): Store[] {
  return catalog.stores ?? [];
}

/** Every view in every store. Absent means none, exactly as with tables. */
export function allViews(catalog: Catalog): View[] {
  return allStores(catalog).flatMap((s) => s.views ?? []);
}

/** The views of one store, without the caller having to know the field is optional. */
export function storeViews(store: Store): View[] {
  return store.views ?? [];
}

/**
 * What a view reads, table by table: what it declares, then everything its
 * columns point at that it forgot to declare. A view is allowed to state only
 * one of the two — the coarse list is easier to write by hand, the column
 * lineage is what an extractor produces — and readers should not have to know
 * which of the two the catalog happened to carry.
 */
export function viewReads(view: View): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  for (const id of view.reads ?? []) add(id);
  for (const column of view.columns) {
    for (const ref of column.from ?? []) add(relationOfColumnId(ref));
  }
  return out;
}

/**
 * The relation half of a column id. Ids are dotted all the way down and only
 * the last segment is the column name, so this is a right split, not a left
 * one: "shop.oms.pg.orders.status" is the `status` column of `shop.oms.pg.orders`.
 */
export function relationOfColumnId(id: string): string {
  return id.split(".").slice(0, -1).join(".");
}

/** The column half of a column id — everything after the last dot. */
export function columnNameOfId(id: string): string {
  return id.split(".").at(-1) ?? "";
}

/**
 * A column's id. Columns are not addressed in the JSON, but the selection layer
 * needs one identifier per selectable thing, and "<table id>.<column>" is the
 * spelling a reader would type.
 */
export function columnId(tableId: string, column: string): string {
  return `${tableId}.${column}`;
}

/** The columns a collapsed table card shows: its key, then everything it points at. */
export function keyColumns(table: Table): Column[] {
  return table.columns.filter((c) => c.pk || c.fk);
}
