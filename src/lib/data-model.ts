// The persistence axis, derived. Pure over a catalog and its index, like
// derive.ts and backlinks.ts: no DOM, no router, so every number a Data tab or
// a Persistence section shows can be asserted in a test.
//
// The interesting work here is the join between two vocabularies. A schema
// speaks in `uuid` and `timestamptz`; a domain model speaks in `string` and
// `time.Time`. Neither is authoritative and neither is wrong, so nothing is
// rewritten into the other — the two are put side by side and the places where
// they disagree are marked.

import type {
  Aggregate,
  Catalog,
  CatalogIndex,
  Column,
  ColumnOwner,
  Field,
  Service,
  Store,
  Table,
  View,
} from "../catalog";
import {
  aggregateBlocks,
  blockFields,
  mapsFieldPath,
  storeViews,
} from "../catalog";

// ---------------------------------------------------------------------------
// Stores and services
// ---------------------------------------------------------------------------

/**
 * How a service touches a store. Ownership is the store's own claim, so a
 * service that lists a store it does not own is reading it — which is a fact
 * the canvas draws (ghosted) rather than an error.
 */
export type StoreAccess = "owns" | "reads";

export interface ServiceStore {
  store: Store;
  access: StoreAccess;
}

/**
 * Every store a service touches: the ones it owns first, in catalog order,
 * then the ones it only reads. A store it owns but forgot to list is still
 * owned — the list is a claim about reading, never about ownership.
 */
export function storesOfService(
  index: CatalogIndex,
  serviceId: string,
): ServiceStore[] {
  const owned = index.storesOwnedBy.get(serviceId) ?? [];
  const out: ServiceStore[] = owned.map((store) => ({
    store,
    access: "owns" as const,
  }));

  const service = index.serviceById.get(serviceId);
  for (const storeId of service?.stores ?? []) {
    const store = index.storeById.get(storeId);
    if (!store || store.owner === serviceId) continue;
    out.push({ store, access: "reads" });
  }
  return out;
}

/** Services that list a store they do not own — its readers, in catalog order. */
export function readersOfStore(
  catalog: Catalog,
  storeId: string,
  ownerId: string,
): Service[] {
  const out: Service[] = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      if (service.id === ownerId) continue;
      if ((service.stores ?? []).includes(storeId)) out.push(service);
    }
  }
  return out;
}

/**
 * How many columns a store holds, for the header line above an ER canvas.
 * A view's columns are counted apart: they are not storage, and adding them to
 * the total would inflate "how big is this schema" with rows that do not exist.
 */
export function storeColumnCount(store: Store): number {
  return store.tables.reduce((n, t) => n + t.columns.length, 0);
}

/** How many views a store declares. */
export function storeViewCount(store: Store): number {
  return storeViews(store).length;
}

/**
 * The views presenting an aggregate, alongside the tables that hold it. A
 * report a service reads its own aggregate through belongs on that aggregate's
 * page: it is one of the ways the model is actually queried.
 */
export interface PresentedView {
  view: View;
  store: Store;
}

export function viewsPresenting(
  index: CatalogIndex,
  aggregateId: string,
): PresentedView[] {
  const out: PresentedView[] = [];
  for (const view of index.viewsByAggregate.get(aggregateId) ?? []) {
    const held = index.viewById.get(view.id);
    if (held) out.push({ view, store: held.store });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregates and blocks
// ---------------------------------------------------------------------------

export interface PersistedTable {
  table: Table;
  store: Store;
}

/**
 * The tables that hold an aggregate — those naming it in `persists`, plus the
 * ones naming one of its blocks. A child table pointing at a value object of
 * the aggregate is still where that aggregate lives.
 */
export function tablesPersisting(
  index: CatalogIndex,
  aggregateId: string,
): PersistedTable[] {
  const out: PersistedTable[] = [];
  const seen = new Set<string>();
  for (const table of index.tablesByAggregate.get(aggregateId) ?? []) {
    const held = index.tableById.get(table.id);
    if (!held || seen.has(table.id)) continue;
    seen.add(table.id);
    out.push({ table, store: held.store });
  }
  return out;
}

/** Columns whose `maps` lands in a block, in table then column order. */
export function columnsOfBlock(
  index: CatalogIndex,
  blockId: string,
): ColumnOwner[] {
  return index.columnsByBlock.get(blockId) ?? [];
}

/**
 * The outbox a service publishes through, if it has one. An event's delivery
 * is a fact about the service that announces it, not about the event, so this
 * is asked once per publisher rather than once per event.
 */
export function outboxOfService(
  index: CatalogIndex,
  serviceId: string,
): PersistedTable | null {
  for (const store of index.storesOwnedBy.get(serviceId) ?? []) {
    for (const table of store.tables) {
      if (table.role === "outbox") return { table, store };
    }
  }
  return null;
}

/** A table's payload column: the first `jsonb`/`json` it holds, if any. */
export function payloadColumn(table: Table): Column | null {
  return table.columns.find((c) => dbClass(c.type) === "json") ?? null;
}

// ---------------------------------------------------------------------------
// Types. Two vocabularies, one comparison.
// ---------------------------------------------------------------------------

/**
 * The shape a type has, once the spelling is set aside. Widths are kept apart
 * on purpose: `int32` in the model against `bigint` in the column is exactly
 * the kind of quiet disagreement this whole comparison exists to surface.
 */
export type TypeClass =
  | "uuid"
  | "text"
  | "int16"
  | "int32"
  | "int64"
  | "float"
  | "decimal"
  | "bool"
  | "time"
  | "json"
  | "bytes"
  | "unknown";

/** Strips `[]`, pointers, parameters: "varchar(64)" and "*string" are still one type. */
function bare(type: string): string {
  return type
    .trim()
    .replace(/^\*+/, "")
    .replace(/^\[\]/, "")
    .replace(/\(.*\)$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const DB_CLASSES: Record<string, TypeClass> = {
  uuid: "uuid",
  text: "text",
  varchar: "text",
  "character varying": "text",
  character: "text",
  char: "text",
  citext: "text",
  smallint: "int16",
  int2: "int16",
  smallserial: "int16",
  integer: "int32",
  int: "int32",
  int4: "int32",
  serial: "int32",
  bigint: "int64",
  int8: "int64",
  bigserial: "int64",
  numeric: "decimal",
  decimal: "decimal",
  money: "decimal",
  real: "float",
  float4: "float",
  "double precision": "float",
  float8: "float",
  boolean: "bool",
  bool: "bool",
  timestamptz: "time",
  "timestamp with time zone": "time",
  timestamp: "time",
  "timestamp without time zone": "time",
  date: "time",
  time: "time",
  timetz: "time",
  jsonb: "json",
  json: "json",
  bytea: "bytes",
};

const DOMAIN_CLASSES: Record<string, TypeClass> = {
  string: "text",
  "uuid.uuid": "uuid",
  uuid: "uuid",
  int16: "int16",
  int32: "int32",
  rune: "int32",
  int64: "int64",
  int: "int64",
  uint64: "int64",
  uint32: "int32",
  float32: "float",
  float64: "float",
  bool: "bool",
  "time.time": "time",
  "time.duration": "int64",
  "decimal.decimal": "decimal",
  "json.rawmessage": "json",
  byte: "bytes",
};

export function dbClass(type: string): TypeClass {
  return DB_CLASSES[bare(type)] ?? "unknown";
}

export function domainClass(type: string): TypeClass {
  return DOMAIN_CLASSES[bare(type)] ?? "unknown";
}

/**
 * True when a column and the field it maps to disagree about what they hold.
 *
 * A type either side does not recognise is NOT a mismatch. Half the domain
 * types in a catalog are named shapes — Money, GatewayRef — and calling every
 * one of them a disagreement with `numeric` would bury the two or three real
 * ones under a page of amber dots.
 */
export function typesDisagree(dbType: string, domainType: string): boolean {
  const a = dbClass(dbType);
  const b = domainClass(domainType);
  if (a === "unknown" || b === "unknown") return false;
  return a !== b;
}

// ---------------------------------------------------------------------------
// The join: a column, the field it maps to, and whether they agree.
// ---------------------------------------------------------------------------

export interface StoredField {
  owner: ColumnOwner;
  /** The `maps` path as written, e.g. "Order.CustomerID". */
  maps: string;
  /** The field half of that path. */
  path: string;
  /** The domain field, when the block actually declares one by that name. */
  field: Field | null;
  /** Set when both types are recognised and they are not the same shape. */
  mismatch: boolean;
}

/**
 * Every column stored against a block, joined to the field it claims to carry.
 * A `maps` naming a field the block does not declare resolves to `field: null`
 * — the column is still shown, because a column pointing at a field that is no
 * longer there is precisely what a reader needs to see.
 */
export function storedFields(
  catalog: Catalog,
  index: CatalogIndex,
  blockId: string,
): StoredField[] {
  const owner = index.blockById.get(blockId);
  if (!owner) return [];
  const fields = blockFields(catalog, owner.block);

  return columnsOfBlock(index, blockId).map((columnOwner) => {
    const maps = columnOwner.column.maps ?? "";
    const path = mapsFieldPath(maps);
    // One level only: "Total.Amount" is matched on "Total", the field the
    // block itself declares, and the nested shape is read on its own page.
    const head = path.split(".")[0] ?? "";
    const field = fields.find((f) => f.name === head) ?? null;
    return {
      owner: columnOwner,
      maps,
      path,
      field,
      mismatch: field
        ? typesDisagree(columnOwner.column.type, field.type)
        : false,
    };
  });
}

/**
 * Fields of an aggregate's blocks that no column maps to. This is the evidence
 * behind "persistence drift": a table claiming to persist an aggregate whose
 * fields it does not carry is either mid-migration or mis-labelled, and either
 * way the claim is worth less than it looks.
 */
export function unmappedFields(
  catalog: Catalog,
  index: CatalogIndex,
  aggregate: Aggregate,
): number {
  let total = 0;
  let mapped = 0;
  for (const { block } of aggregateBlocks(aggregate)) {
    const fields = blockFields(catalog, block);
    total += fields.length;
    const paths = new Set(
      columnsOfBlock(index, block.id).map(
        (o) => mapsFieldPath(o.column.maps ?? "").split(".")[0] ?? "",
      ),
    );
    mapped += fields.filter((f) => paths.has(f.name)).length;
  }
  return total - mapped;
}
