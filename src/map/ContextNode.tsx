// A bounded context, as a node on the map.
//
// Bigger than a service node because it holds three things a service node does
// not have to: the domain's name, its id, and how the estate rates it. On a
// map of six boxes the colour IS the identity, so the tile is bigger here too
// - it is what makes a card read as "shop" from across the screen.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Boxes } from "lucide-react";
import { contextVar } from "../lib/context-color";
import type { PortolanNode } from "../graph/nodes";

export const CTX_NODE_W = 224;
export const CTX_NODE_H = 62;

export function ContextNode({ data }: NodeProps<PortolanNode>) {
  const accent = contextVar(data.context);

  return (
    <div
      className="flow-card flex h-full w-full items-center gap-2.5 px-3"
      style={{ color: "var(--fg)" }}
      title={data.sub ? `${data.sub} — ${data.label}` : data.label}
    >
      <span
        className="flow-tile"
        style={{ color: accent, width: 28, height: 28 }}
      >
        <Boxes size={15} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex items-baseline gap-2">
          <span
            className="truncate text-sm font-semibold"
            style={{ lineHeight: 1.2 }}
          >
            {data.sub ?? data.label}
          </span>
          {data.tag ? (
            /* A badge, tinted the way a status badge is: the core domain
               takes the app's accent, the others take their own colour. */
            <span
              className="ml-auto shrink-0 rounded-full px-1.5"
              style={{
                fontSize: 9,
                lineHeight: "14px",
                fontWeight: 600,
                background: `color-mix(in srgb, ${
                  data.tag === "core" ? "var(--accent)" : accent
                } 14%, transparent)`,
                color: data.tag === "core" ? "var(--accent)" : accent,
              }}
            >
              {data.tag}
            </span>
          ) : null}
        </div>
        <span className="mono truncate" style={{ color: accent, fontSize: 11 }}>
          {data.label}
        </span>
      </div>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

/** Registered under the same key the other graphs use, so one <ReactFlow> prop swaps the renderer. */
export const contextNodeTypes = { portolan: ContextNode };
