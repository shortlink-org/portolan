// One table, as a card.
//
// The rows come from RelationCard, which a view uses too. What is left here is
// the header: the table's name, what it is FOR, and which aggregate it holds —
// the three facts that decide how every row under it should be read.

import type { NodeProps } from "@xyflow/react";
import { Link } from "react-router";
import { contextVar } from "../lib/context-color";
import { aggregatePath } from "../routes";
import { HEADER_H } from "./spec";
import { Badge, CardFrame, ColumnRows } from "./RelationCard";
import type { ErTableNode } from "./RelationCard";

/**
 * Roles that change how a table is READ get a dashed border: an outbox and a
 * projection are both derived — nothing in them is the source of truth — and
 * that is the one thing a reader has to know before believing a row.
 */
function isDerived(role: string | undefined): boolean {
  return role === "outbox" || role === "projection";
}

export function TableNodeCard({ data }: NodeProps<ErTableNode>) {
  const { node, matched, dimmed, onToggle } = data;
  const table = node.table;
  if (!table) return null;

  const accent = node.ghost ? "var(--fg-muted)" : contextVar(node.context);
  const aggregateTo = node.aggregate ? aggregatePath(node.aggregate) : null;
  // The chip is a caption on the table's name, so it shows the aggregate's own
  // slug; the full id is in the title and one click away.
  const aggregateSlug = node.aggregate?.split(".").at(-1) ?? "";

  return (
    <CardFrame
      matched={matched}
      dimmed={dimmed}
      dashed={isDerived(table.role) || node.ghost}
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
          background: `color-mix(in srgb, ${accent} 9%, var(--flow-card))`,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span className="truncate text-ink">{table.name}</span>
        {node.badge ? <Badge>{node.badge}</Badge> : null}
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

      <ColumnRows data={data} relationId={table.id} />
    </CardFrame>
  );
}
