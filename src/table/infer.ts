// What a markdown table's columns are, when nobody declared them.
//
// An index page says what its columns hold. A README cannot, so the column
// type is read out of the cells themselves - and only when EVERY non-empty
// cell in the column agrees. One ambiguous cell and the column is text, which
// is the type that is never wrong, only unhelpful.

import type { ColumnType } from "./types";

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const VERSION_RE = /^v?\d+(\.\d+)*$/;
/**
 * Deliberately narrower than `Date.parse`, which accepts "1" as a year and
 * "Sat" as a weekday. A README column is a date when it is written like one:
 * ISO, with or without a time.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function every(cells: string[], test: (cell: string) => boolean): boolean {
  return cells.every(test);
}

/**
 * The type of one column, from its body cells. The header is not a sample —
 * "version" is a word, and a column of versions headed "version" would infer
 * as text if it were counted.
 *
 * Order matters and is the spec's: numeric wins over version, so a column of
 * bare integers is a number and only "1.2.3" shapes become versions.
 */
export function inferColumnType(cells: readonly string[]): ColumnType {
  const values = cells.map((cell) => cell.trim()).filter((cell) => cell !== "");
  // A column with nothing in it is text: there is no evidence for anything else.
  if (values.length === 0) return "text";
  if (every(values, (cell) => NUMBER_RE.test(cell))) return "number";
  if (every(values, (cell) => VERSION_RE.test(cell))) return "version";
  if (every(values, (cell) => DATE_RE.test(cell) && !Number.isNaN(Date.parse(cell))))
    return "date";
  return "text";
}

/** Every column's type, from a body given as rows of plain-text cells. */
export function inferColumnTypes(
  rows: readonly (readonly string[])[],
  columns: number,
): ColumnType[] {
  return Array.from({ length: columns }, (_, i) =>
    inferColumnType(rows.map((row) => row[i] ?? "")),
  );
}
