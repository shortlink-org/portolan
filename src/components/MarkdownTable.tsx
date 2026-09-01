// A table in a README, rendered as the same table as everywhere else.
//
// The point is not consistency for its own sake: a README table is often the
// one place a fact is written down, and a fact you can sort, filter and copy
// out is more useful than a fact you have to read past. So the renderer takes
// the GFM table apart, works out what each column HOLDS by looking at it, and
// hands the pieces to the same primitive the index pages use.
//
// Two limits keep it quiet. A table of three rows or fewer stays a plain
// table - there is nothing to sort in three rows, and a toolbar over them is
// furniture. And an author who knows better can say so in a comment.

import { Children, isValidElement, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";
import { DataTable } from "../table/DataTable";
import { inferColumnTypes } from "../table/infer";
import { defaultAlign } from "../table/types";
import type { ColumnSpec } from "../table/types";
import {
  NO_DIRECTIVE,
  TABLE_DIRECTIVE_ATTR,
  columnSlug,
  parseTableDirective,
} from "../lib/table-directive";
import type { TableDirective } from "../lib/table-directive";

/** Below this many rows a table is left as it was written. */
const ENHANCE_ABOVE = 3;
/** A README's toolbar waits longer than an index page's. */
const TOOLBAR_AT = 10;

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return textOf(props?.children);
  }
  return "";
}

/** The children of a React element, as an array, whatever shape they arrived in. */
function kids(node: ReactNode): ReactNode[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return Children.toArray(node.props.children);
}

/** Every element of one tag name among a node's children, at any depth of one. */
function elements(
  nodes: ReactNode[],
  tag: string,
): ReactElement<{ children?: ReactNode; style?: { textAlign?: string } }>[] {
  const out: ReactElement<{
    children?: ReactNode;
    style?: { textAlign?: string };
  }>[] = [];
  for (const node of nodes) {
    if (!isValidElement(node)) continue;
    if (node.type === tag) {
      out.push(
        node as ReactElement<{
          children?: ReactNode;
          style?: { textAlign?: string };
        }>,
      );
    }
    // remark wraps rows in <thead>/<tbody>; a bare <tr> is possible too.
    else out.push(...elements(kids(node), tag));
  }
  return out;
}

/** GFM's colon syntax, as react-markdown leaves it: an inline text-align. */
function alignOf(cell: {
  props: { style?: { textAlign?: string } };
}): "left" | "right" | undefined {
  const style = cell.props.style;
  if (style?.textAlign === "right") return "right";
  if (style?.textAlign === "left" || style?.textAlign === "center") {
    return "left";
  }
  return undefined;
}

interface MarkdownRow {
  id: string;
  /** The cell as the author wrote it: links, code and emphasis intact. */
  cells: ReactNode[];
  /** The same cell as plain text, for sorting, filtering and export. */
  text: string[];
}

interface Parsed {
  headers: string[];
  aligns: (("left" | "right") | undefined)[];
  rows: MarkdownRow[];
}

/** Pulls a rendered GFM table apart into headers, alignments and rows. */
function parseTable(children: ReactNode): Parsed {
  const nodes = Children.toArray(children);
  const headerRow = elements(
    elements(nodes, "thead").flatMap((thead) => kids(thead)),
    "tr",
  )[0];
  const headerCells = headerRow ? elements(kids(headerRow), "th") : [];
  const headers = headerCells.map((cell) => textOf(cell.props.children));
  const aligns = headerCells.map(alignOf);

  const bodyRows = elements(
    elements(nodes, "tbody").flatMap((tbody) => kids(tbody)),
    "tr",
  );
  const rows = bodyRows.map((row, index) => {
    const cells = elements(kids(row), "td");
    return {
      id: String(index),
      cells: cells.map((cell) => cell.props.children),
      text: cells.map((cell) => textOf(cell.props.children).trim()),
    };
  });

  return { headers, aligns, rows };
}

/**
 * The directive left on the table by the remark plugin. Reading it off the
 * hast node rather than off props keeps it out of the DOM.
 */
function directiveOf(node: unknown): TableDirective {
  const properties = (node as { properties?: Record<string, unknown> })
    ?.properties;
  const raw = properties?.[TABLE_DIRECTIVE_ATTR];
  return typeof raw === "string" ? parseTableDirective(raw) : NO_DIRECTIVE;
}

export function MarkdownTable({
  node,
  children,
}: {
  node?: unknown;
  children?: ReactNode;
}) {
  const directive = directiveOf(node);
  const { headers, aligns, rows } = useMemo(
    () => parseTable(children),
    [children],
  );

  const types = useMemo(
    () => inferColumnTypes(rows.map((row) => row.text), headers.length),
    [rows, headers.length],
  );

  const columns = useMemo<ColumnSpec<MarkdownRow>[]>(() => {
    const taken = new Set<string>();
    return headers.map((header, i) => {
      const id = columnSlug(header, taken);
      taken.add(id);
      const type = types[i] ?? "text";
      return {
        id,
        header,
        type,
        value: (row: MarkdownRow) => row.text[i],
        // The author's own cell, formatting and all. What the column type
        // decides here is how it sorts and which way it lines up, not what it
        // says - a README's dates should read as the README wrote them.
        cell: (row: MarkdownRow) => row.cells[i],
        // The colon syntax is the author being explicit, and beats the type.
        align: aligns[i] ?? defaultAlign(type),
        primary: i === 0,
      };
    });
  }, [headers, aligns, types]);

  // Stable across reloads for the same table, and different for a different
  // one: enough for a README, which has no id of its own to offer.
  const tableId = useMemo(
    () => `md.${headers.map((h) => columnSlug(h, new Set())).join(".")}`,
    [headers],
  );

  // Nothing to take apart, or nothing worth taking apart.
  if (headers.length === 0 || directive.static || rows.length <= ENHANCE_ABOVE) {
    return <table>{children}</table>;
  }

  return (
    <DataTable
      tableId={tableId}
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      defaultSort={
        directive.sort &&
        columns.some((column) => column.id === directive.sort?.id)
          ? [directive.sort]
          : []
      }
      toolbarAt={TOOLBAR_AT}
      minimal
      className="my-3"
    />
  );
}
