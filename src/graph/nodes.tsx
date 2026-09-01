import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { Server } from "lucide-react";
import { EventIcon } from "../components/ddd-icons";
import { contextVar } from "../lib/context-color";
import { NODE_RADIUS } from "./theme";

export type ServiceNodeData = {
  label: string;
  context: string | null;
  ghost: boolean;
  kind: "service" | "event" | "producer" | "context";
  /**
   * What this node is to the graph it is in - "publisher", "consumer". The
   * kind says what an entity IS; the role says why it is on this canvas, and
   * on a picture of one event that is the more useful of the two.
   */
  role?: string;
  /** Second line, on the nodes big enough to hold one. */
  sub?: string;
  /** Right-aligned tag - a context's classification, and nothing else so far. */
  tag?: string;
};

export type PortolanNode = Node<ServiceNodeData, "portolan">;

/** Fallback when a graph does not name the role itself. */
const ROLE: Record<ServiceNodeData["kind"], string> = {
  producer: "publisher",
  event: "event",
  service: "service",
  context: "context",
};

/**
 * The node the focused event graph draws. (The dependency graph and the
 * context map register their own components under the same `portolan` key,
 * so this one is not shared - it used to be, and the comment saying so
 * outlived the split.)
 *
 * Two lines rather than one. A single mono word in a box is a label, and a
 * reader has to work out from its position what it is a label FOR; the
 * eyebrow says so outright - publisher, event, consumer - and takes the
 * colour, which leaves the name below it plain and readable. The wash is the
 * same 10% one the context map uses, for the same reason: it is what makes a
 * box read as belonging to something from across the screen.
 */
export function PortolanNode({ data, selected }: NodeProps<PortolanNode>) {
  const accent = data.ghost
    ? "var(--status-unresolved)"
    : data.kind === "event"
      ? // An event is amber everywhere else in the app; it was blue here only
        // because blue is what --accent happened to be.
        "var(--kind-event)"
      : contextVar(data.context);
  const Icon = data.kind === "event" ? EventIcon : Server;
  // A node the catalog does not know is not a publisher or a consumer - it is
  // a name someone wrote down, and the eyebrow is where that is said.
  const eyebrow = data.ghost
    ? "not in catalog"
    : (data.role ?? ROLE[data.kind]);

  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-0.5 px-2.5"
      style={{
        background: `linear-gradient(to right, color-mix(in srgb, ${accent} 10%, var(--surface)), var(--surface))`,
        border: `1px ${data.ghost ? "dashed" : "solid"} ${accent}`,
        borderLeftWidth: 3,
        borderRadius: NODE_RADIUS,
        color: data.ghost ? "var(--status-unresolved)" : "var(--fg)",
        outline: selected ? "1px solid var(--accent)" : undefined,
        outlineOffset: 1,
        boxShadow: "var(--shadow-xs)",
      }}
      title={data.ghost ? `${data.label} — not in the catalog` : data.label}
    >
      <span
        className="mono flex items-center gap-1 truncate uppercase"
        style={{
          color: accent,
          fontSize: 9,
          lineHeight: 1.3,
          letterSpacing: "0.06em",
        }}
      >
        <Icon size={10} aria-hidden />
        {eyebrow}
      </span>
      <span className="mono truncate" style={{ fontSize: 12, lineHeight: 1.3 }}>
        {data.label}
      </span>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export const nodeTypes = { portolan: PortolanNode };
