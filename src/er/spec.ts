// What an ER canvas draws, worked out before anything is rendered.
//
// Pure, like lib/context-map.ts: a store in, nodes and edges out. The canvas
// component then only positions and paints what this decided, which is what
// makes "which columns does a collapsed table show?" a question with a test
// rather than a question with a screenshot.

import type { CatalogIndex, Column, Store, Table } from "../catalog";
import { keyColumns } from "../catalog";

/** Header, one row, and the "+n more" footer, in px. Layout needs the height. */
export const HEADER_H = 28;
export const ROW_H = 18;
export const MORE_H = 16;
export const TABLE_W = 208;

/**
 * Rows drawn before a card starts scrolling inside itself. Twelve is where a
 * card stops being a shape you can take in at a glance and becomes a list you
 * have to read; past that the canvas is better served by a shorter card and a
 * detail panel than by a taller one.
 */
export const MAX_ROWS = 12;

/** How much of a table is on show. */
export type ColumnMode = "keys" | "all";

export interface ErNode {
  id: string;
  table: Table;
  store: Store;
  /** The columns actually drawn, in declaration order. */
  rows: Column[];
  /** Columns left out, summarised as "+n more". */
  hidden: number;
  /** True when `rows` is longer than the card can show without scrolling. */
  scrolls: boolean;
  /** The aggregate this table holds, if it names one. */
  aggregate: string | null;
  /** The context that owns that aggregate — the header tint, and nothing else. */
  context: string | null;
  /** A store the service reads but does not own. */
  ghost: boolean;
  width: number;
  height: number;
}

export interface ErEdge {
  id: string;
  /** Table ids. `from` holds the foreign key, so it is the many end. */
  from: string;
  to: string;
  fromColumn: string;
  toColumn: string;
  /** Printed on the edge only when it is not the database's default. */
  onDelete: string | null;
  /** True when the two tables are owned by different services. */
  cross: boolean;
}

export interface ErSpec {
  nodes: ErNode[];
  edges: ErEdge[];
}

/**
 * `on delete no action` is what a database does when nothing says otherwise, so
 * printing it on an edge adds a word and no fact. Anything else changes what
 * deleting the parent row means, and that belongs on the picture.
 */
function shownOnDelete(onDelete: string | undefined): string | null {
  if (!onDelete) return null;
  const normalised = onDelete.trim().toLowerCase().replace(/\s+/g, " ");
  return normalised === "no action" || normalised === "restrict"
    ? null
    : onDelete;
}

export interface ErOptions {
  mode: ColumnMode;
  /** Tables the reader has opened by hand; they show every column. */
  expanded?: ReadonlySet<string>;
  /** Stores the service reads rather than owns, drawn ghosted. */
  ghost?: boolean;
}

/**
 * The columns a card shows. Keys-only is the default because a foreign key is
 * the only column that says anything about the table NEXT to this one, and the
 * canvas is a picture of what points at what — the rest is detail the panel
 * holds. A table with no keys at all still shows its first rows rather than an
 * empty card: a lookup table with no constraints is still a shape.
 */
export function visibleColumns(table: Table, options: ErOptions): Column[] {
  if (options.mode === "all" || options.expanded?.has(table.id)) {
    return table.columns;
  }
  const keys = keyColumns(table);
  return keys.length > 0 ? keys : table.columns.slice(0, 3);
}

export function nodeHeight(rows: number, hidden: number): number {
  return (
    HEADER_H + Math.min(rows, MAX_ROWS) * ROW_H + (hidden > 0 ? MORE_H : 0)
  );
}

/** One store's canvas. Tables in catalog order; layout decides where they land. */
export function erSpec(
  index: CatalogIndex,
  store: Store,
  options: ErOptions,
): ErSpec {
  const nodes: ErNode[] = store.tables.map((table) => {
    const rows = visibleColumns(table, options);
    const hidden = table.columns.length - rows.length;
    const aggregate = table.persists?.aggregate ?? null;
    const owner = aggregate ? index.aggregateOwner.get(aggregate) : undefined;
    const context = owner
      ? (index.serviceContext.get(owner.id)?.id ?? null)
      : null;
    return {
      id: table.id,
      table,
      store,
      rows,
      hidden,
      scrolls: rows.length > MAX_ROWS,
      aggregate,
      context,
      ghost: options.ghost ?? false,
      width: TABLE_W,
      height: nodeHeight(rows.length, hidden),
    };
  });

  const own = new Set(store.tables.map((t) => t.id));
  const edges: ErEdge[] = [];
  for (const table of store.tables) {
    for (const column of table.columns) {
      const fk = column.fk;
      if (!fk) continue;
      // An edge is drawn only when both ends are on this canvas. A key into
      // another service's store is a fact about the boundary, not about this
      // picture, and the Problems page is where it is answered.
      if (!own.has(fk.table)) continue;
      const target = index.tableById.get(fk.table);
      edges.push({
        id: `${table.id}.${column.name}->${fk.table}.${fk.column}`,
        from: table.id,
        to: fk.table,
        fromColumn: column.name,
        toColumn: fk.column,
        onDelete: shownOnDelete(fk.onDelete),
        cross: target ? target.store.owner !== store.owner : false,
      });
    }
  }

  return { nodes, edges };
}

/**
 * Foreign keys leaving this store. They are not edges — there is nothing on
 * the canvas to point at — so they are listed under the store header instead,
 * where "this schema is not self-contained" can actually be read.
 */
export interface ErOutbound {
  from: string;
  fromColumn: string;
  to: string;
  /** The service that owns the far end. */
  peer: string;
}

export function outboundKeys(
  index: CatalogIndex,
  store: Store,
): ErOutbound[] {
  const own = new Set(store.tables.map((t) => t.id));
  const out: ErOutbound[] = [];
  for (const table of store.tables) {
    for (const column of table.columns) {
      const fk = column.fk;
      if (!fk || own.has(fk.table)) continue;
      const target = index.tableById.get(fk.table);
      out.push({
        from: table.id,
        fromColumn: column.name,
        to: fk.table,
        peer: target?.store.owner ?? "unknown",
      });
    }
  }
  return out;
}

/**
 * Tables matching a search term, by name, column name, or the aggregate they
 * hold. Returns ids so the canvas can light them without re-deriving anything.
 */
export function matchingTables(spec: ErSpec, term: string): Set<string> {
  const needle = term.trim().toLowerCase();
  if (!needle) return new Set();
  const out = new Set<string>();
  for (const node of spec.nodes) {
    const hay = [
      node.table.name,
      node.aggregate ?? "",
      node.table.doc ?? "",
      ...node.table.columns.map((c) => c.name),
    ];
    if (hay.some((h) => h.toLowerCase().includes(needle))) out.add(node.id);
  }
  return out;
}
