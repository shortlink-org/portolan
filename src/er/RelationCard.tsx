// The half of a card that a table and a view have in common.
//
// Both are a header over a column listing, and the listing is the content: the
// question a reader brings to an ER canvas is almost never "does this exist" —
// it is "what does this row point at, what points at this one, and where did
// the value come from". So the columns are drawn once, here, and the two cards
// differ only in the header they put above them, which is exactly as much
// difference as there is between the two things.

import { Handle, Position } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { Key, Link2, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import type { Column } from "../catalog";
import { MAX_ROWS, MORE_H, ROW_H } from "./spec";
import type { ErNode } from "./spec";

export type RelationNodeData = {
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
  onToggle: (relationId: string) => void;
  onColumnEnter: (columnId: string | null) => void;
  onColumnClick: (columnId: string) => void;
};

export type ErTableNode = Node<RelationNodeData, "erTable">;
export type ErViewNode = Node<RelationNodeData, "erView">;
export type ErFlowNode = ErTableNode | ErViewNode;

export const HANDLE = {
  opacity: 0,
  width: 1,
  height: 1,
  border: "none",
} as const;

/**
 * The box: border, tint, dimming, and the two anchors an edge falls back to
 * when the column it wants is not on show.
 */
export function CardFrame({
  matched,
  selected,
  dimmed,
  dashed,
  children,
}: {
  matched: boolean;
  selected: boolean;
  dimmed: boolean;
  /** Nothing in here is the source of truth: a view, a projection, an outbox. */
  dashed: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="mono flex h-full w-full flex-col overflow-hidden"
      style={{
        background: "var(--surface)",
        border: `1px ${dashed ? "dashed" : "solid"} ${
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
      {children}

      {/* A card with no anchored column still needs somewhere for an edge to
          land — a key into a column the collapsed card is not showing, or a
          view that says only which table it reads. */}
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

/** The chip beside a card's name: "root", "outbox", "matview". */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className="shrink-0 rounded-[2px] border px-1 text-muted"
      style={{ borderColor: "var(--border)", fontSize: 9 }}
    >
      {children}
    </span>
  );
}

/** The column listing, and the "+n more" footer when the card is collapsed. */
export function ColumnRows({
  data,
  relationId,
}: {
  data: RelationNodeData;
  relationId: string;
}) {
  const {
    node,
    anchors,
    litColumns,
    selectedColumn,
    onToggle,
    onColumnEnter,
    onColumnClick,
  } = data;

  return (
    <>
      <div
        className="flex-1"
        style={{
          overflowY: node.scrolls ? "auto" : "visible",
          maxHeight: MAX_ROWS * ROW_H,
        }}
      >
        {node.rows.map((column) => (
          <ColumnRow
            key={column.name}
            column={column}
            id={`${relationId}.${column.name}`}
            anchored={anchors.has(column.name)}
            lit={
              litColumns.has(`${relationId}.${column.name}`) ||
              selectedColumn === `${relationId}.${column.name}`
            }
            onEnter={onColumnEnter}
            onClick={onColumnClick}
          />
        ))}
      </div>

      {node.hidden > 0 ? (
        <button
          type="button"
          onClick={() => onToggle(relationId)}
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
    </>
  );
}

function ColumnRow({
  column,
  id,
  anchored,
  lit,
  onEnter,
  onClick,
}: {
  column: Column;
  id: string;
  anchored: boolean;
  lit: boolean;
  onEnter: (columnId: string | null) => void;
  onClick: (columnId: string) => void;
}) {
  const derived = (column.from?.length ?? 0) > 0;
  return (
    <div
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={() => onEnter(null)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(id);
      }}
      title={
        column.doc ??
        (derived
          ? `${column.name} ${column.type} — from ${column.from?.join(", ")}`
          : `${column.name} ${column.type}`)
      }
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
      {/* Two different glyphs for two different claims: a key points at a row,
          lineage says the value was copied from one. */}
      {column.fk ? (
        <Link2 size={9} aria-hidden className="shrink-0 text-muted" />
      ) : null}
      {derived ? (
        <Waypoints size={9} aria-hidden className="shrink-0 text-muted" />
      ) : null}

      {/* Anchors on both sides. Which one an edge uses is decided after
          layout, from where the two cards actually landed. */}
      {anchored ? (
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
}
