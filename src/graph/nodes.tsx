import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { contextVar } from "../lib/context-color";
import { NODE_RADIUS } from "./theme";

export type ServiceNodeData = {
  label: string;
  context: string | null;
  ghost: boolean;
  kind: "service" | "event" | "producer" | "context";
  /** Second line, on the nodes big enough to hold one. */
  sub?: string;
  /** Right-aligned tag - a context's classification, and nothing else so far. */
  tag?: string;
};

export type PortolanNode = Node<ServiceNodeData, "portolan">;

/**
 * One node component for both computed graphs, so the dependency view and the
 * focused event view cannot drift apart visually.
 */
export function PortolanNode({ data, selected }: NodeProps<PortolanNode>) {
  const accent = data.ghost
    ? "var(--status-unresolved)"
    : data.kind === "event"
      ? "var(--accent)"
      : contextVar(data.context);

  return (
    <div
      className="mono flex h-full w-full items-center gap-2 px-2.5"
      style={{
        background:
          data.kind === "event" ? "var(--surface-2)" : "var(--surface)",
        border: `1px ${data.ghost ? "dashed" : "solid"} ${accent}`,
        borderRadius: NODE_RADIUS,
        color: data.ghost ? "var(--status-unresolved)" : "var(--fg)",
        outline: selected ? `1px solid var(--accent)` : undefined,
        outlineOffset: 1,
        fontSize: 11,
      }}
      title={data.ghost ? `${data.label} — not in the catalog` : data.label}
    >
      <span
        aria-hidden
        className="h-full w-[3px] shrink-0"
        style={{ background: accent }}
      />
      <span className="truncate">{data.label}</span>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export const nodeTypes = { portolan: PortolanNode };
