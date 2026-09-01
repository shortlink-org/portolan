// One table, as a card.
//
// The card is a schema listing, not a box with a name in it, because the
// question a reader brings to an ER canvas is almost never "does this table
// exist" — it is "what does this row point at, and what points at this one".
// So the columns are the content and the header is the label, and every column
// that takes part in a relationship carries its own anchor.

import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Key, Link2 } from "lucide-react";
import { Link } from "react-router";
import { contextVar } from "../lib/context-color";
import { aggregatePath } from "../routes";
import { HEADER_H, MAX_ROWS, MORE_H, ROW_H } from "./spec";
import type { ErNode } from "./spec";

export type TableNodeData = {
  node: ErNode;
  /** Column names that take part in an edge, so only those grow anchors. */
  anchors: ReadonlySet<string>;
  /** Search hit: lifted rather than dimmed, so the eye lands on it. */
  matched: boolean;
  /** Something else is lit and this is not it. */
  dimmed: boolean;
  /** Columns lit by a hover, on a row here or on an edge somewhere else. */
  litColumns: ReadonlySet<string>;
  selectedColumn: string | null;
  onToggle: (tableId: string) => void;
  onColumnEnter: (columnId: string | null) => void;
  onColumnClick: (columnId: string) => void;
};

export type ErTableNode = Node<TableNodeData, "erTable">;

/**
 * Roles that change how a table is READ get a dashed border: an outbox and a
 * projection are both derived — nothing in them is the source of truth — and
 * that is the one thing a reader has to know before believing a row.
 */
function isDerived(role: string | undefined): boolean {
  return role === "outbox" || role === "projection";
}

const ROLE_LABEL: Record<string, string> = {
  "aggregate-root": "root",
  child: "child",
  outbox: "outbox",
  projection: "projection",
  lookup: "lookup",
  other: "",
};

export function TableNodeCard({ data, selected }: NodeProps<ErTableNode>) {
  const {
    node,
    anchors,
    matched,
    dimmed,
    litColumns,
    selectedColumn,
    onToggle,
    onColumnEnter,
    onColumnClick,
  } = data;
  const { table } = node;
  const accent = node.ghost ? "var(--fg-muted)" : contextVar(node.context);
  const aggregateTo = node.aggregate ? aggregatePath(node.aggregate) : null;
  const role = table.role ?? "other";
  // The chip is a caption on the table's name, so it shows the aggregate's own
  // slug; the full id is in the title and one click away.
  const aggregateSlug = node.aggregate?.split(".").at(-1) ?? "";

  return (
    <div
      className="mono flex h-full w-full flex-col overflow-hidden"
      style={{
        background: "var(--surface)",
        border: `1px ${isDerived(table.role) || node.ghost ? "dashed" : "solid"} ${
          matched || selected ? "var(--accent)" : "var(--border)"
        }`,
        borderRadius: 2,
        opacity: dimmed ? 0.3 : 1,
        outline: selected ? "1px solid var(--accent)" : undefined,
        outlineOffset: 1,
        fontSize: 11,
        transition: "opacity 120ms ease-out",
      }}
    >
      {/* Header. Tinted by the context that owns the aggregate this table
          holds — never by the store's kind, never by the table's type. */}
      {/* The click is not swallowed: it opens the card AND selects the table,
          which is the one gesture a reader makes when they want to know more
          about it. The links inside are the exceptions, and stop it. */}
      <button
        type="button"
        onClick={() => onToggle(table.id)}
        title={table.doc ?? table.name}
        className="flex w-full shrink-0 items-center gap-1.5 px-2 text-left"
        style={{
          height: HEADER_H,
          background: `color-mix(in srgb, ${accent} 14%, var(--surface))`,
          borderBottom: "1px solid var(--border)",
          borderLeft: `2px solid ${accent}`,
        }}
      >
        <span className="truncate text-ink">{table.name}</span>
        {ROLE_LABEL[role] ? (
          <span
            className="shrink-0 rounded-[2px] border px-1 text-muted"
            style={{ borderColor: "var(--border)", fontSize: 9 }}
          >
            {ROLE_LABEL[role]}
          </span>
        ) : null}
        {node.aggregate ? (
          <span
            className="ml-auto shrink-0 truncate"
            style={{ fontSize: 9, maxWidth: 78 }}
            title={`persists ${node.aggregate}`}
          >
            {aggregateTo ? (
              <Link
                to={aggregateTo}
                onClick={(e) => e.stopPropagation()}
                className="rounded-control hover:underline"
                style={{ color: accent }}
              >
                {aggregateSlug}
              </Link>
            ) : (
              <span className="text-muted">{aggregateSlug}</span>
            )}
          </span>
        ) : null}
      </button>

      <div
        className="flex-1"
        style={{
          overflowY: node.scrolls ? "auto" : "visible",
          maxHeight: MAX_ROWS * ROW_H,
        }}
      >
        {node.rows.map((column) => {
          const columnId = `${table.id}.${column.name}`;
          const lit = litColumns.has(columnId) || selectedColumn === columnId;
          return (
            <div
              key={column.name}
              onMouseEnter={() => onColumnEnter(columnId)}
              onMouseLeave={() => onColumnEnter(null)}
              onClick={(e) => {
                e.stopPropagation();
                onColumnClick(columnId);
              }}
              title={column.doc ?? `${column.name} ${column.type}`}
              className="relative flex items-center gap-1 px-2"
              style={{
                height: ROW_H,
                background: lit ? "var(--surface-2)" : undefined,
                cursor: "pointer",
              }}
            >
              {column.pk ? (
                <Key size={9} aria-hidden className="shrink-0 text-ink" />
              ) : (
                <span aria-hidden className="w-[9px] shrink-0" />
              )}
              <span className="truncate text-ink">{column.name}</span>
              <span className="ml-auto shrink-0 truncate text-muted">
                {column.type}
                {column.nullable ? "?" : ""}
              </span>
              {column.fk ? (
                <Link2 size={9} aria-hidden className="shrink-0 text-muted" />
              ) : null}

              {/* Anchors on both sides. Which one an edge uses is decided
                  after layout, from where the two tables actually landed. */}
              {anchors.has(column.name) ? (
                <>
                  <Handle
                    id={`l:${column.name}`}
                    type="source"
                    position={Position.Left}
                    isConnectable={false}
                    style={HANDLE}
                  />
                  <Handle
                    id={`r:${column.name}`}
                    type="source"
                    position={Position.Right}
                    isConnectable={false}
                    style={HANDLE}
                  />
                  <Handle
                    id={`tl:${column.name}`}
                    type="target"
                    position={Position.Left}
                    isConnectable={false}
                    style={HANDLE}
                  />
                  <Handle
                    id={`tr:${column.name}`}
                    type="target"
                    position={Position.Right}
                    isConnectable={false}
                    style={HANDLE}
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {node.hidden > 0 ? (
        <button
          type="button"
          onClick={() => onToggle(table.id)}
          className="shrink-0 px-2 text-left text-muted hover:text-ink"
          style={{
            height: MORE_H,
            fontSize: 9,
            borderTop: "1px dashed var(--border)",
          }}
        >
          +{node.hidden} more
        </button>
      ) : null}

      {/* A table with no anchored column still needs somewhere for an edge to
          land — a foreign key into a column the collapsed card is not showing. */}
      <Handle
        id="table"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={HANDLE}
      />
      <Handle
        id="table-source"
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={HANDLE}
      />
    </div>
  );
}

const HANDLE = { opacity: 0, width: 1, height: 1, border: "none" } as const;

export const erNodeTypes = { erTable: TableNodeCard };
