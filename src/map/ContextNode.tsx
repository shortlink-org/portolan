// A bounded context, as a node on the map.
//
// Bigger than a service node because it holds three things a service node does
// not have to: the domain's name, its id, and how the estate rates it. It is
// the only node in the app that carries a wash of its own colour rather than
// just an edge of it - on a map of six boxes the colour IS the identity, and
// the same 6% wash the page headers use is what makes a box read as "shop"
// from across the screen.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { contextVar } from "../lib/context-color";
import { NODE_RADIUS } from "../graph/theme";
import type { PortolanNode } from "../graph/nodes";

export const CTX_NODE_W = 208;
export const CTX_NODE_H = 62;

export function ContextNode({ data, selected }: NodeProps<PortolanNode>) {
  const accent = contextVar(data.context);

  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-0.5 px-3"
      style={{
        background: `linear-gradient(to right, color-mix(in srgb, ${accent} 10%, var(--surface)), var(--surface))`,
        border: `1px solid ${accent}`,
        borderLeftWidth: 3,
        borderRadius: NODE_RADIUS,
        color: "var(--fg)",
        outline: selected ? "1px solid var(--accent)" : undefined,
        outlineOffset: 1,
      }}
      title={data.sub ? `${data.sub} — ${data.label}` : data.label}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="truncate text-sm font-semibold"
          style={{ lineHeight: 1.2 }}
        >
          {data.sub ?? data.label}
        </span>
        {data.tag ? (
          <span
            className="mono ml-auto shrink-0 rounded-[4px] border px-1"
            style={{
              fontSize: 10,
              lineHeight: "14px",
              borderColor: data.tag === "core" ? "var(--accent)" : accent,
              color: data.tag === "core" ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            {data.tag}
          </span>
        ) : null}
      </div>
      <span className="mono truncate" style={{ color: accent, fontSize: 11 }}>
        {data.label}
      </span>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

/** Registered under the same key the other graphs use, so one <ReactFlow> prop swaps the renderer. */
export const contextNodeTypes = { portolan: ContextNode };
