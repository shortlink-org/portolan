// The frame around one model group's tables, when a schema is laid out by
// group. It is a background, not a card: it takes no clicks, so the pane
// behind it still clears the selection, and the cards inside it are drawn on
// top. Only its label is live, and leads to the group's own page.
//
// Each frame has a tint of its own, cycled through the same six hues the
// contexts use, so that two neighbouring groups read as two at a glance and
// the label is not the only thing telling them apart.

import type { Node, NodeProps } from "@xyflow/react";
import { Link } from "react-router";
import { aggregatePath } from "../routes";

export interface GroupNodeData extends Record<string, unknown> {
  name: string;
  aggregate: string | null;
  count: number;
  /** A CSS colour the frame is washed with. */
  tint: string;
}

export type ErGroupNode = Node<GroupNodeData, "erGroup">;

export function GroupNodeCard({ data, width, height }: NodeProps<ErGroupNode>) {
  const to = data.aggregate ? aggregatePath(data.aggregate) : null;
  const label = `${data.name} · ${data.count}`;
  return (
    <div
      className="rounded-card border"
      style={{
        width,
        height,
        background: `color-mix(in srgb, ${data.tint} 9%, transparent)`,
        borderColor: `color-mix(in srgb, ${data.tint} 45%, transparent)`,
        pointerEvents: "none",
      }}
      data-er-group={data.aggregate ?? "other"}
    >
      <div
        className="mono inline-block rounded-br-card px-2 py-0.5"
        style={{
          pointerEvents: "auto",
          color: data.tint,
          background: `color-mix(in srgb, ${data.tint} 14%, transparent)`,
        }}
      >
        {to ? (
          <Link to={to} className="hover:underline" title={`Open ${data.name}`}>
            {label}
          </Link>
        ) : (
          <span title="tables that persist no model">{label}</span>
        )}
      </div>
    </div>
  );
}
