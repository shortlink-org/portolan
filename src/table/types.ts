// What a column is, before anything knows how to draw one.
//
// A column here is not "a header and a render function": it is a declared
// type, and the type is what decides how the column sorts, which way it is
// aligned, whether it offers a chip-set to filter by, and what a cell looks
// like. Declaring `version` once is what stops v10 from sorting before v2 on
// one page and after it on the next.

import type { ReactNode } from "react";

export type ColumnType =
  | "text"
  /** Ids, paths, type names — anything the reader will paste somewhere else. */
  | "mono"
  | "number"
  /** Semver-ish: v2 sorts before v10, never after it. */
  | "version"
  /** ISO in, "3 days ago" on screen, the timestamp on hover. */
  | "date"
  /** verified > declared > unresolved. */
  | "status"
  /** A DDD kind, in taxonomy order rather than alphabetical. */
  | "kind"
  /** A number that is also a link to the things it counted. */
  | "count";

/**
 * What a cell is worth to everything that is not the renderer: the sort, the
 * filter, the export. `undefined` is the empty cell, and it is the only empty
 * there is — an accessor that would return null or "" returns undefined, so
 * that one value can be sorted last in both directions by one rule.
 */
export type CellValue = string | number | undefined;

export interface ColumnSpec<T> {
  /** Stable across renders and reloads: widths and hidden state key off it. */
  id: string;
  header: string;
  type: ColumnType;
  /** The sortable, filterable, exportable value. */
  value: (row: T) => CellValue;
  /** The cell, when the value alone is not the whole of it. */
  cell?: (row: T) => ReactNode;
  /** Where a `count` cell points. */
  href?: (row: T) => string | null | undefined;
  /** Title attribute, for the cell that has more to say than it can show. */
  title?: (row: T) => string | undefined;
  /** Offer this column as a chip-set in the toolbar. status/kind/context. */
  facet?: boolean;
  /** The cell that carries the row link and the j/k focus. Defaults to first. */
  primary?: boolean;
  /** Starting width in px. The reader's dragged width wins over this. */
  size?: number;
  minSize?: number;
  /** Default true, except for the primary column, which cannot be hidden. */
  enableHiding?: boolean;
  enableSorting?: boolean;
  /** Overrides the alignment the type would pick. */
  align?: "left" | "right";
}

/** Numbers line up on the right; everything a reader reads lines up on the left. */
export function defaultAlign(type: ColumnType): "left" | "right" {
  return type === "number" || type === "count" ? "right" : "left";
}

/** Which types the free-text filter searches. The spec's rule, in one place. */
export function isTextish(type: ColumnType): boolean {
  return type === "text" || type === "mono";
}

/** Which types offer a chip-set when the column asks for one. */
export function canFacet(type: ColumnType): boolean {
  return type === "status" || type === "kind" || type === "text";
}

/** Normalizes anything an accessor might hand back into a CellValue. */
export function cellValue(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const text = String(raw);
  return text.trim() === "" ? undefined : text;
}

/** The string a cell exports as, and the string the text filter matches. */
export function cellText(value: CellValue): string {
  return value === undefined ? "" : String(value);
}
