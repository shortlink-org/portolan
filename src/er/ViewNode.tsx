// One view, as a card.
//
// A view is drawn as a table that admits it is not one: same width, same rows,
// dashed border, and a header that says `view` or `matview` before it says
// anything else. That ordering is the whole design. A reader who mistakes a
// view for a table believes rows that may not exist yet, or joins onto a thing
// that has no key — so the card states what it is before it states its name,
// and never grows the primary-key glyph a table's header earns.

import type { NodeProps } from "@xyflow/react";
import { Eye, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { contextVar } from "../lib/context-color";
import { aggregatePath } from "../routes";
import { HEADER_H } from "./spec";
import { Badge, CardFrame, ColumnRows } from "./RelationCard";
import type { ErViewNode } from "./RelationCard";

export function ViewNodeCard({ data }: NodeProps<ErViewNode>) {
  const { node, matched, dimmed, onToggle } = data;
  const view = node.view;
  if (!view) return null;

  const accent = node.ghost ? "var(--fg-muted)" : contextVar(node.context);
  const aggregateTo = node.aggregate ? aggregatePath(node.aggregate) : null;
  const aggregateSlug = node.aggregate?.split(".").at(-1) ?? "";
  const Glyph = view.materialized ? RefreshCw : Eye;

  return (
    <CardFrame
      matched={matched}
      /* Always dashed: nothing in a view is the source of truth, which is the
         same claim the dash makes on an outbox or a projection. */
      dashed
      dimmed={dimmed}
    >
      <button
        type="button"
        onClick={() => onToggle(view.id)}
        title={
          view.definition
            ? `${view.doc ? `${view.doc}\n\n` : ""}${view.definition}`
            : (view.doc ?? view.name)
        }
        className="flex w-full shrink-0 items-center gap-1.5 px-2 text-left"
        style={{
          height: HEADER_H,
          /* Lighter than a table's tint, and striped, so a canvas of twenty
             cards sorts itself into "rows live here" and "rows are computed
             here" before a single name has been read. */
          background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${accent} 8%, var(--flow-card)) 0 6px, var(--flow-card) 6px 12px)`,
          borderBottom: "1px dashed var(--border)",
        }}
      >
        <Glyph size={9} aria-hidden className="shrink-0 text-muted" />
        <span className="truncate text-ink">{view.name}</span>
        {node.badge ? <Badge>{node.badge}</Badge> : null}
        {node.aggregate ? (
          <span
            className="ml-auto shrink-0 truncate"
            style={{ fontSize: 9, maxWidth: 62 }}
            title={`presents ${node.aggregate}`}
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

      <ColumnRows data={data} relationId={view.id} />
    </CardFrame>
  );
}
