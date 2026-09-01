// The table, taken elsewhere.
//
// What leaves is the CURRENT view: filtered, sorted, visible columns only, in
// the order on screen. That is the whole value of it - a reader who has just
// narrowed forty rows to the four that matter wants those four in the issue,
// not the forty they started with, and not in a different order.

/** A view, flattened: the header line and the body, already in display order. */
export interface Sheet {
  headers: string[];
  rows: string[][];
}

/** A cell that would break the row it is in, made safe for one line of GFM. */
function markdownCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    // A GFM row is a line. A cell that contains a newline is not a cell.
    .replace(/\r?\n/g, " ")
    .trim();
}

/**
 * Valid GFM: a header row, a delimiter row of the same width, and one line
 * per row. Column widths are not padded - a diff of a padded table is a diff
 * of every line, and this is written to be pasted into an issue.
 */
export function toMarkdown({ headers, rows }: Sheet): string {
  if (headers.length === 0) return "";
  const line = (cells: string[]) =>
    `| ${headers.map((_, i) => markdownCell(cells[i] ?? "")).join(" | ")} |`;
  return [
    line(headers),
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

/** RFC 4180: quote when the cell holds a comma, a quote, or a line break. */
function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv({ headers, rows }: Sheet): string {
  const line = (cells: string[]) =>
    headers.map((_, i) => csvCell(cells[i] ?? "")).join(",");
  return [line(headers), ...rows.map(line)].join("\r\n");
}

/** A filename a download can carry without quoting anything. */
export function csvFilename(tableId: string): string {
  const slug = tableId.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug === "" ? "table" : slug}.csv`;
}
