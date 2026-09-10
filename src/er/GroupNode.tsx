// The frame around one model group's tables, when a schema is laid out by
// group. It is a background, not a card: it takes no clicks, so the pane
// behind it still clears the selection, and the cards inside it are drawn on
// top. Only its label is live, and leads to the group's own page.

import type { Node, NodeProps } from "@xyflow/react";
import { Link } from "react-router";
import { aggregatePath } from "../routes";

export interface GroupNodeData extends Record<string, unknown> {
  name: string;
  aggregate: string | null;
  count: number;
}

export type ErGroupNode = Node<GroupNodeData, "erGroup">;

export function GroupNodeCard({ data, width, height }: NodeProps<ErGroupNode>) {
  const to = data.aggregate ? aggregatePath(data.aggregate) : null;
  const label = `${data.name} · ${data.count}`;
  return (
    <div
      className="rounded-card border border-dashed border-line"
      style={{
        width,
        height,
        background: "color-mix(in srgb, var(--surface) 55%, transparent)",
        pointerEvents: "none",
      }}
      data-er-group={data.aggregate ?? "other"}
    >
      <div className="mono px-2 py-1 text-muted" style={{ pointerEvents: "auto", display: "inline-block" }}>
        {to ? (
          <Link to={to} className="hover:text-ink hover:underline" title={`Open ${data.name}`}>
            {label}
          </Link>
        ) : (
          <span title="tables that persist no model">{label}</span>
        )}
      </div>
    </div>
  );
}
