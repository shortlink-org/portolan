// What an ER canvas draws, worked out before anything is rendered.
//
// Pure, like lib/context-map.ts: a store in, nodes and edges out. The canvas
// component then only positions and paints what this decided, which is what
// makes "which columns does a collapsed table show?" a question with a test
// rather than a question with a screenshot.
//
// A canvas carries two kinds of card and two kinds of edge. Tables and views
// are both relations with columns, so they are drawn alike and told apart by
// their header; foreign keys and lineage are both lines between columns, so
// they are drawn alike and told apart by their direction and their dash. The
// difference that matters is what a reader can conclude: a key says a row
// points at a row, lineage says a value was copied from a value.

import type {
  CatalogIndex,
  Column,
  Store,
  Table,
  View,
} from "../catalog";
import {
  columnNameOfId,
  relationOfColumnId,
  storeViews,
  viewReads,
} from "../catalog";
import { lineageEdgeId } from "./lineage";

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

/** A card is a table or a view; everything else about them is the same. */
export type ErNodeKind = "table" | "view";

export interface ErNode {
  id: string;
  kind: ErNodeKind;
  name: string;
  doc: string | null;
  /** The table, when this card is one. Exactly one of these two is set. */
  table: Table | null;
  /** The view, when this card is one. */
  view: View | null;
  store: Store;
  /** Every column the relation has, in declaration order. */
  columns: Column[];
  /** The columns actually drawn, in declaration order. */
  rows: Column[];
  /** Columns left out, summarised as "+n more". */
  hidden: number;
  /** True when `rows` is longer than the card can show without scrolling. */
  scrolls: boolean;
  /** The aggregate this relation holds or presents, if it names one. */
  aggregate: string | null;
  /** The context that owns that aggregate — the header tint, and nothing else. */
  context: string | null;
  /** A store the service reads but does not own. */
  ghost: boolean;
  /** The word on the header chip: "root", "outbox", "view", "matview". */
  badge: string | null;
  width: number;
  height: number;
}

/**
 * What a line between two cards means.
 *
 * "fk" is a constraint the database enforces and is drawn child → parent, with
 * the crow's foot at the child. "lineage" is a copy the database performs and
 * is drawn source → derived, with a plain arrow: it is a direction of travel,
 * not a cardinality, and drawing it with the same marks would say the view
 * constrains the table it reads.
 */
export type ErEdgeKind = "fk" | "lineage";

export interface ErEdge {
  id: string;
  kind: ErEdgeKind;
  /** Relation ids. For "fk", `from` holds the key, so it is the many end. */
  from: string;
  to: string;
  /** Null on a lineage edge that only knows the relation it reads. */
  fromColumn: string | null;
  toColumn: string | null;
  /** Printed on the edge only when it is not the database's default. */
  onDelete: string | null;
  /** True when the two relations are owned by different services. */
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
  /** Views on the canvas. On by default — a schema is what the reader asked for. */
  views?: boolean;
  /** Lineage edges. On by default, and off is a legible picture, not a broken one. */
  lineage?: boolean;
}

/** Anything with columns and an id: a table or a view, asked the same question. */
type Relation = { id: string; columns: Column[] };

/**
 * The columns a card shows. Keys-only is the default because a foreign key is
 * the only column that says anything about the table NEXT to this one, and the
 * canvas is a picture of what points at what — the rest is detail the panel
 * holds. A derived column counts as a key for this purpose: it is the one thing
 * on a view that joins it to anything else, and a view whose every column were
 * hidden would be a card with a name and nothing under it.
 *
 * A relation with none of those still shows its first rows rather than an empty
 * card: a lookup table with no constraints is still a shape.
 */
export function visibleColumns(
  relation: Relation,
  options: ErOptions,
): Column[] {
  if (options.mode === "all" || options.expanded?.has(relation.id)) {
    return relation.columns;
  }
  const joined = relation.columns.filter(
    (c) => c.pk || c.fk || (c.from?.length ?? 0) > 0,
  );
  return joined.length > 0 ? joined : relation.columns.slice(0, 3);
}

export function nodeHeight(rows: number, hidden: number): number {
  return (
    HEADER_H + Math.min(rows, MAX_ROWS) * ROW_H + (hidden > 0 ? MORE_H : 0)
  );
}

const ROLE_BADGE: Record<string, string> = {
  "aggregate-root": "root",
  child: "child",
  outbox: "outbox",
  projection: "projection",
  lookup: "lookup",
};

/** One store's canvas. Relations in catalog order; layout decides where they land. */
export function erSpec(
  index: CatalogIndex,
  store: Store,
  options: ErOptions,
): ErSpec {
  const showViews = options.views ?? true;
  const showLineage = options.lineage ?? true;

  /** The context that owns an aggregate, which is all the tint ever reads. */
  const contextOf = (aggregate: string | null): string | null => {
    const owner = aggregate ? index.aggregateOwner.get(aggregate) : undefined;
    return owner ? (index.serviceContext.get(owner.id)?.id ?? null) : null;
  };

  const card = (
    id: string,
    kind: ErNodeKind,
    name: string,
    doc: string | undefined,
    columns: Column[],
    aggregate: string | null,
    badge: string | null,
    table: Table | null,
    view: View | null,
  ): ErNode => {
    const rows = visibleColumns({ id, columns }, options);
    const hidden = columns.length - rows.length;
    return {
      id,
      kind,
      name,
      doc: doc ?? null,
      table,
      view,
      store,
      columns,
      rows,
      hidden,
      scrolls: rows.length > MAX_ROWS,
      aggregate,
      context: contextOf(aggregate),
      ghost: options.ghost ?? false,
      badge,
      width: TABLE_W,
      height: nodeHeight(rows.length, hidden),
    };
  };

  const nodes: ErNode[] = store.tables.map((table) =>
    card(
      table.id,
      "table",
      table.name,
      table.doc,
      table.columns,
      table.persists?.aggregate ?? null,
      ROLE_BADGE[table.role ?? "other"] ?? null,
      table,
      null,
    ),
  );

  if (showViews) {
    for (const view of storeViews(store)) {
      nodes.push(
        card(
          view.id,
          "view",
          view.name,
          view.doc,
          view.columns,
          view.persists?.aggregate ?? null,
          view.materialized ? "matview" : "view",
          null,
          view,
        ),
      );
    }
  }

  const own = new Set(nodes.map((n) => n.id));
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
        kind: "fk",
        from: table.id,
        to: fk.table,
        fromColumn: column.name,
        toColumn: fk.column,
        onDelete: shownOnDelete(fk.onDelete),
        cross: target ? target.store.owner !== store.owner : false,
      });
    }
  }

  if (showLineage) {
    /** Relations already joined by a column-level edge, so `reads` can skip them. */
    const joined = new Set<string>();
    for (const node of nodes) {
      for (const column of node.columns) {
        for (const ref of column.from ?? []) {
          const source = relationOfColumnId(ref);
          if (!own.has(source) || source === node.id) continue;
          joined.add(`${source}->${node.id}`);
          const from = index.tableById.get(source) ?? index.viewById.get(source);
          edges.push({
            id: lineageEdgeId(ref, `${node.id}.${column.name}`),
            kind: "lineage",
            from: source,
            to: node.id,
            fromColumn: columnNameOfId(ref),
            toColumn: column.name,
            onDelete: null,
            cross: from ? from.store.owner !== store.owner : false,
          });
        }
      }
    }

    // A view that says what it reads but not which column fed which is still
    // telling the reader something they cannot get anywhere else, so it gets a
    // line — one per pair, drawn card to card rather than row to row.
    for (const node of nodes) {
      if (!node.view) continue;
      for (const readId of viewReads(node.view)) {
        if (!own.has(readId) || readId === node.id) continue;
        if (joined.has(`${readId}->${node.id}`)) continue;
        joined.add(`${readId}->${node.id}`);
        edges.push({
          id: lineageEdgeId(readId, node.id),
          kind: "lineage",
          from: readId,
          to: node.id,
          fromColumn: null,
          toColumn: null,
          onDelete: null,
          cross: false,
        });
      }
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
 * Columns this store copies from somewhere else. The same shape as an outbound
 * key and for the same reason — the far end is not on the canvas — but a
 * different sentence: a key that leaves the store is a constraint nobody can
 * enforce, a value that comes in from another store is a copy nobody is told
 * to refresh.
 */
export function outboundLineage(
  index: CatalogIndex,
  store: Store,
): ErOutbound[] {
  const own = new Set<string>([
    ...store.tables.map((t) => t.id),
    ...storeViews(store).map((v) => v.id),
  ]);
  const out: ErOutbound[] = [];
  const relations: { id: string; columns: Column[] }[] = [
    ...store.tables,
    ...storeViews(store),
  ];
  for (const relation of relations) {
    for (const column of relation.columns) {
      for (const ref of column.from ?? []) {
        const source = relationOfColumnId(ref);
        if (own.has(source)) continue;
        const target =
          index.tableById.get(source) ?? index.viewById.get(source);
        out.push({
          from: relation.id,
          fromColumn: column.name,
          to: ref,
          peer: target?.store.owner ?? "unknown",
        });
      }
    }
  }
  return out;
}

/**
 * Cards matching a search term, by name, column name, or the aggregate they
 * hold. Returns ids so the canvas can light them without re-deriving anything.
 */
export function matchingNodes(spec: ErSpec, term: string): Set<string> {
  const needle = term.trim().toLowerCase();
  if (!needle) return new Set();
  const out = new Set<string>();
  for (const node of spec.nodes) {
    const hay = [
      node.name,
      node.aggregate ?? "",
      node.doc ?? "",
      node.view?.definition ?? "",
      ...node.columns.map((c) => c.name),
    ];
    if (hay.some((h) => h.toLowerCase().includes(needle))) out.add(node.id);
  }
  return out;
}
