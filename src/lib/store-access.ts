// Who reads and writes which table of one store, derived.
//
// Pure over a catalog, like data-model.ts: no DOM, no router, so every mark
// and every "written by two services" the store page draws can be asserted in
// a test.
//
// A table access is recorded on the store, not on the service that made it,
// because the extractor that proves it reads the store's own repository. Which
// service the call belongs to is therefore read off where its file lives: the
// service whose directory holds the file, the deepest one when directories
// nest, and the store's owner when no service claims the directory - which is
// the ordinary case, a single service reading its own tables. Nothing here
// guesses past that; an access with no source stays with the owner.

import type {
  Catalog,
  Service,
  Store,
  Table,
  TableAccess,
  TableOperation,
} from "../catalog";
import { TABLE_OPERATIONS } from "../catalog";

/**
 * One class or module that touches the store: the receiver of the method the
 * extractor named (`Postgres` of `Postgres.Save`) in the directory its file is
 * in, since two packages routinely both call theirs `Repository`.
 */
export interface AccessRepository {
  /** Unique within the service: directory and receiver. */
  key: string;
  /** What a column header shows; the directory is added only to tell two apart. */
  label: string;
  /** Directory of the file, as the catalog spells sources. */
  dir: string;
}

export interface AccessService {
  id: string;
  /** The store's owner. Every other column is a service reaching in. */
  owner: boolean;
  repositories: AccessRepository[];
  /** Accesses credited to this service, across every table. */
  count: number;
}

export interface AccessCell {
  /** In read, write, delete order, each once. */
  operations: TableOperation[];
  accesses: TableAccess[];
}

export interface AccessRow {
  table: Table;
  /** Keyed by service id, and by `<service id>\u0000<repository key>`. */
  cells: Map<string, AccessCell>;
  /** Services with any access to this table, in column order. */
  services: string[];
  /** Services that write or delete rows of this table, in column order. */
  writers: string[];
  /** Touched by more than one service. */
  shared: boolean;
  /** Written by more than one service: two owners of one set of rows. */
  sharedWrite: boolean;
  accessCount: number;
}

/**
 * A column whose value, or whose foreign key, crosses a store boundary. The
 * direction is this store's: `out` is a column here pointing at another
 * store, `in` is another store's column pointing here.
 */
export interface CrossStoreRef {
  direction: "out" | "in";
  kind: "copy" | "fk";
  /** The column that holds the copy or the key: `<table id>.<column>`. */
  column: string;
  /** Store the column is in. */
  columnStore: string;
  /** What it points at or was copied from: `<table id>.<column>`. */
  target: string;
  /** Store the target is in; null when no catalog store holds it. */
  targetStore: string | null;
}

export interface StoreAccessMatrix {
  services: AccessService[];
  rows: AccessRow[];
  /** Every access on every table, however it was credited. */
  accessCount: number;
  /**
   * Services that list the store among the ones they read, with no table
   * access of theirs recorded. They get no column: an empty column would say
   * they touch nothing, and all that is known is that they touch something.
   */
  declaredReaders: string[];
  crossStore: CrossStoreRef[];
}

const SEP = "\u0000";

/** The key a repository column's cells are stored under. */
export function repositoryCellKey(service: string, repository: string): string {
  return `${service}${SEP}${repository}`;
}

function splitSource(source: string): { path: string; dir: string } {
  const path = source.replace(/:\d+(?::\d+)?$/, "");
  const slash = path.lastIndexOf("/");
  return { path, dir: slash >= 0 ? path.slice(0, slash) : "" };
}

function receiverOf(access: TableAccess): string | null {
  const method = access.method ?? "";
  const dot = method.lastIndexOf(".");
  return dot > 0 ? method.slice(0, dot) : null;
}

function repositoryOf(access: TableAccess): { key: string; receiver: string; dir: string } {
  const { path, dir } = splitSource(access.source ?? "");
  const receiver = receiverOf(access);
  if (receiver) return { key: `${dir}${SEP}${receiver}`, receiver, dir };
  // No receiver to name: the file is the closest thing the source says.
  const file = path.slice(path.lastIndexOf("/") + 1) || access.method || "SQL client call";
  return { key: `${dir}${SEP}${file}`, receiver: file, dir };
}

/**
 * The service an access belongs to. Only services in the owner's repository
 * are candidates, because a source is spelled from that repository's root.
 */
export function creditAccess(
  access: TableAccess,
  owner: Service | undefined,
  services: readonly Service[],
): string | null {
  if (!owner) return null;
  if (!access.source) return owner.id;
  const { path } = splitSource(access.source);
  let best: Service[] = [];
  let depth = -1;
  for (const service of services) {
    if (service.repo !== owner.repo) continue;
    const root = service.path.replace(/\/+$/, "");
    if (!root || !path.startsWith(`${root}/`)) continue;
    if (root.length > depth) {
      best = [service];
      depth = root.length;
    } else if (root.length === depth) {
      best.push(service);
    }
  }
  // Two services declared at one directory cannot be told apart by it.
  if (best.length !== 1) return owner.id;
  return best[0]!.id;
}

function relationStores(catalog: Catalog): Map<string, string> {
  const out = new Map<string, string>();
  for (const store of catalog.stores ?? []) {
    for (const table of store.tables) out.set(table.id, store.id);
    for (const view of store.views ?? []) out.set(view.id, store.id);
  }
  return out;
}

function relationOf(columnRef: string): string {
  const dot = columnRef.lastIndexOf(".");
  return dot > 0 ? columnRef.slice(0, dot) : columnRef;
}

/** Copies and foreign keys that leave `store` or arrive in it. */
export function crossStoreRefs(store: Store, catalog: Catalog): CrossStoreRef[] {
  const home = relationStores(catalog);
  const out: CrossStoreRef[] = [];
  for (const other of catalog.stores ?? []) {
    for (const table of other.tables) {
      for (const column of table.columns) {
        const holder = `${table.id}.${column.name}`;
        const targets: { kind: "copy" | "fk"; target: string }[] = [
          ...(column.from ?? []).map((target) => ({ kind: "copy" as const, target })),
          ...(column.fk
            ? [{ kind: "fk" as const, target: `${column.fk.table}.${column.fk.column}` }]
            : []),
        ];
        for (const { kind, target } of targets) {
          const targetStore = home.get(relationOf(target)) ?? null;
          if (targetStore === other.id) continue;
          if (other.id === store.id) {
            out.push({ direction: "out", kind, column: holder, columnStore: other.id, target, targetStore });
          } else if (targetStore === store.id) {
            out.push({ direction: "in", kind, column: holder, columnStore: other.id, target, targetStore });
          }
        }
      }
    }
  }
  // Copies first: a foreign key across stores is at least declared to the
  // database, a copy is known only to the code that made it.
  return out.sort(
    (a, b) =>
      (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1) ||
      (a.kind === b.kind ? 0 : a.kind === "copy" ? -1 : 1) ||
      a.column.localeCompare(b.column) ||
      a.target.localeCompare(b.target),
  );
}

function addTo(cells: Map<string, AccessCell>, key: string, access: TableAccess) {
  const cell = cells.get(key) ?? { operations: [], accesses: [] };
  cell.accesses.push(access);
  if (!cell.operations.includes(access.operation)) {
    cell.operations.push(access.operation);
    cell.operations.sort(
      (a, b) => TABLE_OPERATIONS.indexOf(a) - TABLE_OPERATIONS.indexOf(b),
    );
  }
  cells.set(key, cell);
}

/**
 * The matrix for one store: a row per table, a column per service with a
 * recorded access, and each service's repositories for when it is opened up.
 *
 * Rows are ordered by the question the page asks - where does more than one
 * service reach into the same rows - so tables written by several services
 * come first, then tables read by several, then the rest by name, and tables
 * with no recorded access last: they are a different finding, not a quieter
 * version of the same one.
 */
export function storeAccessMatrix(store: Store, catalog: Catalog): StoreAccessMatrix {
  const services = catalog.contexts.flatMap((context) => context.services);
  const owner = services.find((service) => service.id === store.owner);
  const repositories = new Map<string, Map<string, { receiver: string; dir: string }>>();
  const counts = new Map<string, number>();

  const credited = store.tables.map((table) => {
    const cells = new Map<string, AccessCell>();
    for (const access of table.accesses ?? []) {
      const service = creditAccess(access, owner, services) ?? store.owner;
      const repository = repositoryOf(access);
      addTo(cells, service, access);
      addTo(cells, repositoryCellKey(service, repository.key), access);
      const known = repositories.get(service) ?? new Map();
      known.set(repository.key, { receiver: repository.receiver, dir: repository.dir });
      repositories.set(service, known);
      counts.set(service, (counts.get(service) ?? 0) + 1);
    }
    return { table, cells };
  });

  const columns: AccessService[] = [...repositories.entries()]
    .map(([id, known]) => {
      const receivers = new Map<string, number>();
      for (const { receiver } of known.values())
        receivers.set(receiver, (receivers.get(receiver) ?? 0) + 1);
      const list = [...known.entries()].map(([key, { receiver, dir }]) => ({
        key,
        dir,
        label:
          (receivers.get(receiver) ?? 0) > 1
            ? `${dir.slice(dir.lastIndexOf("/") + 1) || "."}/${receiver}`
            : receiver,
      }));
      list.sort((a, b) => a.label.localeCompare(b.label) || a.dir.localeCompare(b.dir));
      return { id, owner: id === store.owner, repositories: list, count: counts.get(id) ?? 0 };
    })
    .sort(
      (a, b) =>
        Number(b.owner) - Number(a.owner) || b.count - a.count || a.id.localeCompare(b.id),
    );
  const order = columns.map((column) => column.id);

  const rows: AccessRow[] = credited.map(({ table, cells }) => {
    const touching = order.filter((id) => cells.has(id));
    const writers = touching.filter((id) =>
      cells.get(id)!.operations.some((operation) => operation !== "read"),
    );
    return {
      table,
      cells,
      services: touching,
      writers,
      shared: touching.length > 1,
      sharedWrite: writers.length > 1,
      accessCount: (table.accesses ?? []).length,
    };
  });
  const rank = (row: AccessRow) =>
    row.sharedWrite ? 0 : row.shared ? 1 : row.accessCount > 0 ? 2 : 3;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.services.length - a.services.length ||
      a.table.name.localeCompare(b.table.name),
  );

  const declaredReaders = services
    .filter(
      (service) =>
        service.id !== store.owner &&
        (service.stores ?? []).includes(store.id) &&
        !repositories.has(service.id),
    )
    .map((service) => service.id)
    .sort();

  return {
    services: columns,
    rows,
    accessCount: rows.reduce((sum, row) => sum + row.accessCount, 0),
    declaredReaders,
    crossStore: crossStoreRefs(store, catalog),
  };
}
